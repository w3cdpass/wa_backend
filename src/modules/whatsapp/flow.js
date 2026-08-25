import { Flow, FlowRun } from '../../models/index.js';
import { MessageAPI, createMessageAPI } from '../meta/index.js';
import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { WhatsAppConfigService } from '../whatsapp/config.js';
import { normalizePhone, phoneVariants } from '../../utils/phone.js';

const NODE_TYPES = {
  START: 'start',
  SEND_MESSAGE: 'send_message',
  SEND_MEDIA: 'send_media',
  SEND_BUTTONS: 'send_buttons',
  SEND_LIST: 'send_list',
  SEND_TEMPLATE: 'send_template',
  CONDITION: 'condition',
  COLLECT_INPUT: 'collect_input',
  SET_TAG: 'set_tag',
  HANDOFF: 'handoff',
  END: 'end',
};

function matchReplyId(node, replyId) {
  if (!node.config) return null;
  const nodeType = node.backendNodeType || node.nodeType;
  
  if (nodeType === NODE_TYPES.SEND_BUTTONS) {
    const hit = node.config.buttons?.find(b => b.replyId === replyId);
    return hit?.nextNodeKey || null;
  }
  
  if (nodeType === NODE_TYPES.SEND_LIST) {
    for (const section of node.config.sections || []) {
      const hit = section.rows?.find(r => r.replyId === replyId);
      if (hit) return hit.nextNodeKey;
    }
    return null;
  }
  
  return null;
}

function matchesKeywordTrigger(text, config) {
  if (!text || !config.keywords?.length) return false;
  
  const matchType = config.matchType || 'contains';
  const caseSensitive = config.caseSensitive || false;
  
  const haystack = caseSensitive ? text : text.toLowerCase();
  
  for (const raw of config.keywords) {
    if (!raw) continue;
    const needle = caseSensitive ? raw : raw.toLowerCase();
    
    if (matchType === 'exact' ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

function entryTriggerTexts(message) {
  if (message.kind === 'text') return [message.text];
  
  const texts = new Set();
  if (message.replyTitle) texts.add(message.replyTitle);
  if (message.replyId) texts.add(message.replyId);
  
  return Array.from(texts).filter(t => t && t.trim());
}

function isAutoAdvancing(nodeType) {
  return [
    NODE_TYPES.START,
    NODE_TYPES.SEND_MESSAGE,
    NODE_TYPES.SEND_MEDIA,
    NODE_TYPES.CONDITION,
    NODE_TYPES.SET_TAG,
  ].includes(nodeType);
}

function isSuspending(nodeType) {
  return [
    NODE_TYPES.SEND_BUTTONS,
    NODE_TYPES.SEND_LIST,
    NODE_TYPES.SEND_TEMPLATE,
    NODE_TYPES.COLLECT_INPUT,
  ].includes(nodeType);
}

function isTerminal(nodeType) {
  return [NODE_TYPES.END, NODE_TYPES.HANDOFF].includes(nodeType);
}

function evaluateCondition(variables, predicate) {
  if (!predicate) return false;
  
  const { field, operator, value } = predicate;
  const varValue = variables[field];
  
  switch (operator) {
    case 'equals': return varValue === value;
    case 'not_equals': return varValue !== value;
    case 'contains': return String(varValue || '').includes(String(value));
    case 'not_contains': return !String(varValue || '').includes(String(value));
    case 'starts_with': return String(varValue || '').startsWith(String(value));
    case 'ends_with': return String(varValue || '').endsWith(String(value));
    case 'greater_than': return Number(varValue) > Number(value);
    case 'less_than': return Number(varValue) < Number(value);
    case 'is_empty': return varValue === undefined || varValue === null || varValue === '';
    case 'is_not_empty': return varValue !== undefined && varValue !== null && varValue !== '';
    default: return false;
  }
}

export class FlowEngine {
  constructor() {
    this.messageAPICache = new Map();
    this.configService = new WhatsAppConfigService();
  }

  getMessageAPI(accessToken) {
    if (!this.messageAPICache.has(accessToken)) {
      this.messageAPICache.set(accessToken, createMessageAPI(accessToken));
    }
    return this.messageAPICache.get(accessToken);
  }

  async _getConfig(tenantId) {
    const config = await this.configService.getConfig(tenantId);
    if (!config) throw new Error('WhatsApp not configured');
    return config;
  }

  async _getContactPhone(tenantId, contactId) {
    const { Contact } = await import('../../models/index.js');
    const contact = await Contact.findById(contactId);
    if (!contact) throw new Error('Contact not found');
    return contact.phone;
  }

  async dispatchInbound(input) {
    const { tenantId, contactId, conversationId, message, isFirstInbound } = input;
    
    console.log(`[flow] dispatchInbound tenant=${tenantId} contact=${contactId} msg=${JSON.stringify(message)}`);
    
    const existingRun = await FlowRun.findOne({ 
      tenantId, 
      contactId, 
      status: 'running' 
    });
    
    if (existingRun) {
      console.log(`[flow] found existing running run ${existingRun._id} at node ${existingRun.currentNodeKey}`);
      return this.advanceRun(existingRun, message);
    }
    
    const flow = await this.findMatchingFlow(tenantId, message, isFirstInbound);
    if (!flow) {
      console.log(`[flow] no matching flow for tenant=${tenantId}`);
      return { consumed: false };
    }
    
    console.log(`[flow] matched flow "${flow.name}" (${flow._id})`);
    
    const run = await FlowRun.create({
      flowId: flow._id,
      tenantId,
      contactId,
      conversationId,
      currentNodeKey: flow.nodes[0]?.nodeKey || 'start',
      status: 'running',
      variables: {},
    });
    
    console.log(`[flow] created run ${run._id} at node ${run.currentNodeKey}`);
    
    return this.advanceRun(run, message);
  }

  async findMatchingFlow(tenantId, message, isFirstInbound) {
    const candidateTexts = entryTriggerTexts(message);
    console.log(`[flow] findMatchingFlow candidateTexts=${JSON.stringify(candidateTexts)}`);
    const flows = await Flow.find({ tenantId, status: 'active' });
    console.log(`[flow] found ${flows.length} active flows`);
    
    for (const flow of flows) {
      const trigger = flow.trigger;
      console.log(`[flow] checking flow "${flow.name}" trigger=${JSON.stringify(trigger)}`);
      
      if (trigger.type === 'keyword') {
        for (const text of candidateTexts) {
          if (matchesKeywordTrigger(text, trigger.config)) {
            console.log(`[flow] keyword match on "${text}"`);
            return flow;
          }
        }
      } else if (trigger.type === 'first_inbound_message' && isFirstInbound) {
        return flow;
      } else if (trigger.type === 'interactive_reply' && message.kind === 'interactive_reply') {
        const replyId = trigger.config.replyId || message.replyId;
        if (replyId === message.replyId) return flow;
      }
    }
    
    return null;
  }

  async advanceRun(run, message) {
    const flow = await Flow.findById(run.flowId);
    if (!flow) {
      await FlowRun.findByIdAndUpdate(run._id, { status: 'failed', error: 'Flow not found' });
      return { consumed: true, outcome: 'failed' };
    }
    
    const node = flow.nodes.find(n => n.nodeKey === run.currentNodeKey);
    if (!node) {
      await this.completeRun(run, 'failed', 'Node not found');
      return { consumed: true, outcome: 'failed' };
    }

    // Resolve node type: prefer backendNodeType (mapped by frontend), fall back to nodeType
    const nodeType = node.backendNodeType || node.nodeType;
    
    // For most suspending nodes, block if message can't advance.
    // For send_template: only block if template was already sent (waiting for reply).
    if (isSuspending(nodeType)) {
      if (nodeType === NODE_TYPES.SEND_TEMPLATE) {
        if (run.lastPromptNodeKey === node.nodeKey && !this.canAdvanceFromSuspending(node, message, run)) {
          return { consumed: true, outcome: 'awaiting_input' };
        }
        // If template not yet sent, fall through to execute it
      } else {
        if (!this.canAdvanceFromSuspending(node, message, run)) {
          return { consumed: true, outcome: 'awaiting_input' };
        }
      }
    }
    
    let nextNodeKey = null;
    let outcome = 'advanced';
    
    switch (nodeType) {
      case NODE_TYPES.START:
        nextNodeKey = this.getNextNodeKey(flow, node.nodeKey);
        break;
        
      case NODE_TYPES.SEND_MESSAGE:
        await this.executeSendMessage(flow, run, node, message);
        nextNodeKey = this.getNextNodeKey(flow, node.nodeKey);
        break;
        
      case NODE_TYPES.SEND_MEDIA:
        await this.executeSendMedia(flow, run, node, message);
        nextNodeKey = this.getNextNodeKey(flow, node.nodeKey);
        break;
        
      case NODE_TYPES.SEND_BUTTONS:
        await this.executeSendButtons(flow, run, node, message);
        outcome = 'suspended';
        break;

      case NODE_TYPES.SEND_LIST:
        await this.executeSendList(flow, run, node, message);
        outcome = 'suspended';
        break;

      case NODE_TYPES.SEND_TEMPLATE: {
        if (message.kind === 'interactive_reply' && this.canAdvanceFromSuspending(node, message)) {
          const btnIndex = this.findTemplateButtonIndex(node, message);
          nextNodeKey = this.getNextNodeKey(flow, node.nodeKey, btnIndex);
          await FlowRun.findByIdAndUpdate(run._id, {
            $set: { [`variables._button_${btnIndex}`]: message.replyTitle || message.replyId },
          });
        } else if (run.lastPromptNodeKey === node.nodeKey) {
          // Template already sent — user typed text instead of tapping a button.
          // Route to first output (default path).
          nextNodeKey = this.getNextNodeKey(flow, node.nodeKey, 0);
        } else {
          await this.executeSendTemplate(flow, run, node, message);
          outcome = 'suspended';
        }
        break;
      }
        
      case NODE_TYPES.CONDITION:
        nextNodeKey = await this.executeCondition(run, node);
        break;
        
      case NODE_TYPES.COLLECT_INPUT:
        await this.executeCollectInput(run, node, message);
        nextNodeKey = this.getNextNodeKey(flow, node.nodeKey);
        break;
        
      case NODE_TYPES.SET_TAG:
        await this.executeSetTag(run, node);
        nextNodeKey = this.getNextNodeKey(flow, node.nodeKey);
        break;
        
      case NODE_TYPES.HANDOFF:
        await this.executeHandoff(run, node);
        outcome = 'handed_off';
        break;
        
      case NODE_TYPES.END:
        outcome = 'completed';
        break;
    }
    
    if (outcome === 'advanced' && nextNodeKey) {
      await FlowRun.findByIdAndUpdate(run._id, { 
        currentNodeKey: nextNodeKey,
        lastActivityAt: new Date(),
      });
      
      if (isAutoAdvancing(flow.nodes.find(n => n.nodeKey === nextNodeKey)?.backendNodeType || flow.nodes.find(n => n.nodeKey === nextNodeKey)?.nodeType)) {
        return this.advanceRun(
          await FlowRun.findById(run._id), 
          { kind: 'auto', text: '' }
        );
      }
    } else if (outcome === 'completed') {
      await this.completeRun(run, 'completed');
    } else if (outcome === 'handed_off') {
      await this.completeRun(run, 'handed_off');
    }
    
    return { consumed: true, outcome, flowRunId: run._id };
  }

  canAdvanceFromSuspending(node, message, run) {
    if (message.kind !== 'interactive_reply') return false;
    const nodeType = node.backendNodeType || node.nodeType;

    if (nodeType === NODE_TYPES.SEND_BUTTONS) {
      return node.config.buttons?.some(b => b.replyId === message.replyId);
    }

    if (nodeType === NODE_TYPES.SEND_LIST) {
      return node.config.sections?.some(s =>
        s.rows?.some(r => r.replyId === message.replyId)
      );
    }

    // Templates: any button tap advances the flow
    if (nodeType === NODE_TYPES.SEND_TEMPLATE) {
      return true;
    }

    if (nodeType === NODE_TYPES.COLLECT_INPUT) {
      return true;
    }

    return false;
  }

  getNextNodeKey(flow, currentNodeKey, outputIndex) {
    // For multi-output nodes (buttons, templates), use outputIndex to pick the edge
    if (outputIndex !== undefined && outputIndex !== null) {
      const edge = flow.edges.find(e => e.from === currentNodeKey && e.outputIndex === outputIndex);
      if (edge) return edge.to;
    }
    // Default: first edge from this node
    const edge = flow.edges.find(e => e.from === currentNodeKey);
    return edge?.to || null;
  }

  async executeSendMessage(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const text = this.interpolateVariables(node.config.text || '', run.variables);
    
    const result = await messageAPI.sendText({
      phoneNumberId: config.phoneNumberId,
      to: phone,
      text,
    });
    
    if (!result || !result.messages) throw new Error('Text send failed');
  }

  async executeSendMedia(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const mediaUrl = this.interpolateVariables(node.config.mediaUrl || '', run.variables);
    const caption = this.interpolateVariables(node.config.caption || '', run.variables);
    
    const result = await messageAPI.sendMedia({
      phoneNumberId: config.phoneNumberId,
      to: phone,
      type: node.config.mediaType || 'image',
      link: mediaUrl,
      caption,
    });
    
    if (!result || !result.messages) throw new Error('Media send failed');
  }

  async executeSendButtons(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const body = this.interpolateVariables(node.config.body || '', run.variables);
    const header = node.config.header ? this.interpolateVariables(node.config.header, run.variables) : null;
    const footer = node.config.footer ? this.interpolateVariables(node.config.footer, run.variables) : null;
    
    const buttons = (node.config.buttons || []).map(b => ({
      id: b.replyId,
      title: this.interpolateVariables(b.title || '', run.variables),
    }));
    
    await FlowRun.findByIdAndUpdate(run._id, {
      lastPromptMessageId: null,
      lastPromptNodeKey: node.nodeKey,
    });
    
    const result = await messageAPI.sendInteractive({
      phoneNumberId: config.phoneNumberId,
      to: phone,
      type: 'button',
      body,
      header,
      footer,
      action: buttons,
    });
  }

  async executeSendList(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const body = this.interpolateVariables(node.config.body || '', run.variables);
    const header = node.config.header ? this.interpolateVariables(node.config.header, run.variables) : null;
    const footer = node.config.footer ? this.interpolateVariables(node.config.footer, run.variables) : null;
    const buttonLabel = this.interpolateVariables(node.config.buttonLabel || 'Options', run.variables);
    
    const sections = (node.config.sections || []).map(s => ({
      title: s.title,
      rows: (s.rows || []).map(r => ({
        id: r.replyId,
        title: this.interpolateVariables(r.title || '', run.variables),
        description: r.description ? this.interpolateVariables(r.description, run.variables) : undefined,
      })),
    }));
    
    await FlowRun.findByIdAndUpdate(run._id, {
      lastPromptMessageId: null,
      lastPromptNodeKey: node.nodeKey,
    });
    
    const result = await messageAPI.sendInteractive({
      phoneNumberId: config.phoneNumberId,
      to: phone,
      type: 'list',
      body,
      header,
      footer,
      action: { button: buttonLabel, sections },
    });
  }

  async executeSendTemplate(flow, run, node, message) {
    const { WhatsAppConfig } = await import('../../models/index.js');
    const { WhatsAppConfigService } = await import('../whatsapp/config.js');
    const configService = new WhatsAppConfigService();
    const config = await configService.getConfig(run.tenantId);
    if (!config) throw new Error('WhatsApp not configured');

    const { Template, Contact } = await import('../../models/index.js');
    const template = await Template.findOne({ tenantId: run.tenantId, name: node.config.templateName });
    if (!template) throw new Error(`Template "${node.config.templateName}" not found`);

    const contact = await Contact.findById(run.contactId);
    if (!contact) throw new Error('Contact not found');

    const messageAPI = this.getMessageAPI(config.accessToken);

    let components;
    try {
      const { buildSendComponents } = await import('../meta/template.js');
      components = buildSendComponents(template, { body: [] });
    } catch (buildErr) {
      console.warn('[executeSendTemplate] buildSendComponents fallback:', buildErr.message);
      components = [];
    }

    const result = await messageAPI.sendTemplate({
      phoneNumberId: config.phoneNumberId,
      to: contact.phone,
      templateName: template.name,
      language: template.language,
      ...(components.length ? { components } : {}),
    });

    if (!result || !result.messages) throw new Error('Template send failed: no message ID returned');

    // Store template info for button matching
    const buttons = (template.buttons || []).map((b, i) => ({
      title: b.text,
      type: b.type,
      index: i,
    }));

    await FlowRun.findByIdAndUpdate(run._id, {
      lastPromptNodeKey: node.nodeKey,
      $set: { [`_templateButtons`]: buttons },
    });
  }

  findTemplateButtonIndex(node, message) {
    // Match by button title or index
    const buttons = node.config.buttons || [];
    const idx = buttons.findIndex(b =>
      b.title === message.replyTitle || b.replyId === message.replyId
    );
    return idx >= 0 ? idx : 0;
  }

  async executeCondition(run, node) {
    const trueNodeKey = node.config.trueNodeKey;
    const falseNodeKey = node.config.falseNodeKey;
    
    const result = evaluateCondition(run.variables, node.config.predicate);
    
    return result ? trueNodeKey : falseNodeKey;
  }

  async executeCollectInput(run, node, message) {
    const varName = node.config.variableName;
    const value = message.text || message.replyTitle || message.replyId;
    
    if (!varName) throw new Error('COLLECT_INPUT requires variableName');
    
    await FlowRun.findByIdAndUpdate(run._id, {
      $set: { [`variables.${varName}`]: value },
    });
  }

  async executeSetTag(run, node) {
    const tag = node.config.tag;
    const action = node.config.action || 'add';
    
    // This would need Contact model
    // await Contact.findByIdAndUpdate(run.contactId, {
    //   $addToSet: action === 'add' ? { tags: tag } : { tags: { $each: [] } },
    //   $pull: action === 'remove' ? { tags: tag } : undefined,
    // });
  }

  async executeHandoff(run, node) {
    const userId = node.config.userId;
    if (userId) {
      await FlowRun.findByIdAndUpdate(run._id, { 
        handoffTo: userId,
        status: 'handed_off',
      });
    }
  }

  async completeRun(run, outcome) {
    await FlowRun.findByIdAndUpdate(run._id, { 
      status: outcome === 'completed' ? 'completed' : 
              outcome === 'handed_off' ? 'handed_off' : 'failed',
      completedAt: new Date(),
    });
  }

  interpolateVariables(text, variables) {
    if (!text) return '';
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] !== undefined ? String(variables[key]) : match;
    });
  }
}

export const flowEngine = new FlowEngine();