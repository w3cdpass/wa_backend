import { Flow, FlowRun } from '../../models/index.js';
import { MessageAPI, createMessageAPI } from '../meta/index.js';
import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { normalizePhone, phoneVariants } from '../../utils/phone.js';

const NODE_TYPES = {
  START: 'start',
  SEND_MESSAGE: 'send_message',
  SEND_MEDIA: 'send_media',
  SEND_BUTTONS: 'send_buttons',
  SEND_LIST: 'send_list',
  CONDITION: 'condition',
  COLLECT_INPUT: 'collect_input',
  SET_TAG: 'set_tag',
  HANDOFF: 'handoff',
  END: 'end',
};

function matchReplyId(node, replyId) {
  if (!node.config) return null;
  
  if (node.nodeType === NODE_TYPES.SEND_BUTTONS) {
    const hit = node.config.buttons?.find(b => b.replyId === replyId);
    return hit?.nextNodeKey || null;
  }
  
  if (node.nodeType === NODE_TYPES.SEND_LIST) {
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
  }

  getMessageAPI(accessToken) {
    if (!this.messageAPICache.has(accessToken)) {
      this.messageAPICache.set(accessToken, createMessageAPI(accessToken));
    }
    return this.messageAPICache.get(accessToken);
  }

  async dispatchInbound(input) {
    const { tenantId, contactId, conversationId, message, isFirstInbound } = input;
    
    const existingRun = await FlowRun.findOne({ 
      tenantId, 
      contactId, 
      status: 'running' 
    });
    
    if (existingRun) {
      return this.advanceRun(existingRun, message);
    }
    
    const flow = await this.findMatchingFlow(tenantId, message, isFirstInbound);
    if (!flow) {
      return { consumed: false };
    }
    
    const run = await FlowRun.create({
      flowId: flow._id,
      tenantId,
      contactId,
      conversationId,
      currentNodeKey: flow.nodes[0]?.nodeKey || 'start',
      status: 'running',
      variables: {},
    });
    
    return this.advanceRun(run, message);
  }

  async findMatchingFlow(tenantId, message, isFirstInbound) {
    const candidateTexts = entryTriggerTexts(message);
    const flows = await Flow.find({ tenantId, status: 'active' });
    
    for (const flow of flows) {
      const trigger = flow.trigger;
      
      if (trigger.type === 'keyword') {
        for (const text of candidateTexts) {
          if (matchesKeywordTrigger(text, trigger.config)) {
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
    
    if (isSuspending(node.nodeType)) {
      if (!this.canAdvanceFromSuspending(node, message, run)) {
        return { consumed: true, outcome: 'awaiting_input' };
      }
    }
    
    let nextNodeKey = null;
    let outcome = 'advanced';
    
    switch (node.nodeType) {
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
      
      if (isAutoAdvancing(flow.nodes.find(n => n.nodeKey === nextNodeKey)?.nodeType)) {
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
    
    if (node.nodeType === NODE_TYPES.SEND_BUTTONS) {
      return node.config.buttons?.some(b => b.replyId === message.replyId);
    }
    
    if (node.nodeType === NODE_TYPES.SEND_LIST) {
      return node.config.sections?.some(s => 
        s.rows?.some(r => r.replyId === message.replyId)
      );
    }
    
    if (node.nodeType === NODE_TYPES.COLLECT_INPUT) {
      return true;
    }
    
    return false;
  }

  getNextNodeKey(flow, currentNodeKey) {
    const edge = flow.edges.find(e => e.from === currentNodeKey);
    return edge?.to || null;
  }

  async executeSendMessage(flow, run, node, message) {
    const config = await WhatsAppConfig.findOne({ tenantId: run.tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const text = this.interpolateVariables(node.config.text || '', run.variables);
    
    const result = await messageAPI.sendText({
      phoneNumberId: config.phoneNumberId,
      to: run.contactId, // This should be the contact's phone
      text,
    });
    
    if (!result.success) throw new Error(result.error);
  }

  async executeSendMedia(flow, run, node, message) {
    const config = await WhatsAppConfig.findOne({ tenantId: run.tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const mediaUrl = this.interpolateVariables(node.config.mediaUrl || '', run.variables);
    const caption = this.interpolateVariables(node.config.caption || '', run.variables);
    
    const result = await messageAPI.sendMedia({
      phoneNumberId: config.phoneNumberId,
      to: run.contactId,
      type: node.config.mediaType || 'image',
      link: mediaUrl,
      caption,
    });
    
    if (!result.success) throw new Error(result.error);
  }

  async executeSendButtons(flow, run, node, message) {
    const config = await WhatsAppConfig.findOne({ tenantId: run.tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    
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
      to: run.contactId,
      type: 'button',
      body,
      header,
      footer,
      action: buttons,
    });
    
    if (!result.success) throw new Error(result.error);
  }

  async executeSendList(flow, run, node, message) {
    const config = await WhatsAppConfig.findOne({ tenantId: run.tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    
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
      to: run.contactId,
      type: 'list',
      body,
      header,
      footer,
      action: { button: buttonLabel, sections },
    });
    
    if (!result.success) throw new Error(result.error);
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

  getMessageAPI(accessToken) {
    if (!this.messageAPICache.has(accessToken)) {
      this.messageAPICache.set(accessToken, createMessageAPI(accessToken));
    }
    return this.messageAPICache.get(accessToken);
  }
}

export const flowEngine = new FlowEngine();