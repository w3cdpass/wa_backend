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

  async markMessageRead(tenantId, metaMessageId) {
    try {
      const config = await this._getConfig(tenantId);
      const messageAPI = this.getMessageAPI(config.accessToken);
      await messageAPI.markRead?.(config.phoneNumberId, metaMessageId);
    } catch (err) {
      console.warn('[flow] markMessageRead failed (non-critical):', err.message);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  DISPATCH INBOUND — entry point for all incoming messages
  // ────────────────────────────────────────────────────────────
  async dispatchInbound(input) {
    const { tenantId, contactId, conversationId, message, isFirstInbound, contextId } = input;

    console.log(`[flow] dispatchInbound tenant=${tenantId} contact=${contactId} kind=${message.kind} contextId=${contextId}`);
    if (message.kind === 'interactive_reply') {
      console.log(`[flow]   replyId="${message.replyId}" replyTitle="${message.replyTitle}"`);
    }
    if (message.kind === 'text') {
      console.log(`[flow]   text="${message.text}"`);
    }

    // ── 1. Find existing running FlowRun ──
    let existingRun = null;

    // 1a. Try by contextId (original template message WAMID) — most precise
    if (contextId) {
      existingRun = await FlowRun.findOne({
        tenantId,
        lastPromptMessageId: contextId,
        status: 'running',
      });
      if (existingRun) {
        console.log(`[flow] found run ${existingRun._id} by contextId=${contextId} at node ${existingRun.currentNodeKey}`);
      }
    }

    // 1b. Fallback: any running run for this contact
    if (!existingRun) {
      existingRun = await FlowRun.findOne({
        tenantId,
        contactId,
        status: 'running',
      });
      if (existingRun) {
        console.log(`[flow] found run ${existingRun._id} by contactId=${contactId} at node ${existingRun.currentNodeKey}`);
      }
    }

    // ── 2. If we found a running run, advance it ──
    if (existingRun) {
      if (message.kind === 'interactive_reply') {
        // Button / list click → dedicated handler
        return this.handleButtonClick(existingRun, message);
      }
      // Regular text → advance with text
      return this.advanceRun(existingRun, message);
    }

    // ── 3. No running run → try to match a flow by trigger ──
    const flow = await this.findMatchingFlow(tenantId, message, isFirstInbound);
    if (!flow) {
      console.log(`[flow] no running run and no matching flow for tenant=${tenantId}`);
      return { consumed: false };
    }

    console.log(`[flow] matched flow "${flow.name}" (${flow._id})`);

    // Close any stale runs for this contact
    await FlowRun.updateMany(
      { tenantId, contactId, status: { $in: ['running', 'paused'] } },
      { $set: { status: 'failed', error: 'Superseded' } },
    );

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

  // ────────────────────────────────────────────────────────────
  //  HANDLE BUTTON CLICK — dedicated handler per user spec
  // ────────────────────────────────────────────────────────────
  async handleButtonClick(run, message) {
    console.log(`[flow] handleButtonClick run=${run._id} node=${run.currentNodeKey} replyId="${message.replyId}" replyTitle="${message.replyTitle}"`);

    try {
      const flow = await Flow.findById(run.flowId);
      if (!flow) {
        await this.completeRun(run, 'failed');
        return { consumed: true, outcome: 'failed' };
      }

      let node = flow.nodes.find(n => n.nodeKey === run.currentNodeKey);
      const nodeType = node?.backendNodeType || node?.nodeType;

      // ── If current node is NOT a template but we have a lastPromptNodeKey
      //    matching a send_template, the user clicked a button on an OLD template
      //    message. Find the original template node and route from there.
      let templateNode = null;
      if (nodeType !== NODE_TYPES.SEND_TEMPLATE && run.lastPromptNodeKey) {
        templateNode = flow.nodes.find(n => n.nodeKey === run.lastPromptNodeKey);
        const templateType = templateNode?.backendNodeType || templateNode?.nodeType;
        if (templateType === NODE_TYPES.SEND_TEMPLATE) {
          console.log(`[flow] current node is ${nodeType}, routing from original template node ${run.lastPromptNodeKey}`);
          node = templateNode;
        } else {
          templateNode = null;
        }
      }

      if (!node) {
        await this.completeRun(run, 'failed');
        return { consumed: true, outcome: 'failed' };
      }

      // ── Send Template button click ──
      if ((node.backendNodeType || node.nodeType) === NODE_TYPES.SEND_TEMPLATE) {
        const btnIndex = this.findTemplateButtonIndex(node, message);
        const outputIndex = btnIndex + 1;
        const nextNodeKey = this.getNextNodeKey(flow, node.nodeKey, outputIndex);

        console.log(`[flow] SEND_TEMPLATE btnIndex=${btnIndex} outputIndex=${outputIndex} nextNodeKey=${nextNodeKey}`);
        console.log(`[flow] buttons:`, JSON.stringify(
          (node.config.templateButtons || node.config.buttons || []).map((b, i) => ({
            i, title: b.title, payload: b.payload, text: b.text,
          }))
        ));
        console.log(`[flow] edges:`, JSON.stringify(
          flow.edges.filter(e => e.from === node.nodeKey).map(e => ({
            to: e.to, outputIndex: e.outputIndex, sourceHandle: e.sourceHandle,
          }))
        ));

        await FlowRun.findByIdAndUpdate(run._id, {
          $set: {
            [`variables._button_${btnIndex}`]: message.replyTitle || message.replyId,
          },
        });

        if (!nextNodeKey) {
          console.log(`[flow] no edge for outputIndex=${outputIndex}`);
          return { consumed: true, outcome: 'completed', flowRunId: run._id };
        }

        await FlowRun.findByIdAndUpdate(run._id, {
          currentNodeKey: nextNodeKey,
          lastActivityAt: new Date(),
        });

        return this.advanceRun(await FlowRun.findById(run._id), { kind: 'auto', text: '' });
      }

      // ── Send Buttons click ──
      if (nodeType === NODE_TYPES.SEND_BUTTONS) {
        const hit = node.config.buttons?.find(b =>
          b.replyId === message.replyId || b.title === message.replyTitle
        );
        if (hit?.nextNodeKey) {
          await FlowRun.findByIdAndUpdate(run._id, {
            currentNodeKey: hit.nextNodeKey,
            lastActivityAt: new Date(),
          });
          return this.advanceRun(await FlowRun.findById(run._id), { kind: 'auto', text: '' });
        }
      }

      // ── Send List click ──
      if (nodeType === NODE_TYPES.SEND_LIST) {
        for (const section of node.config.sections || []) {
          const hit = section.rows?.find(r =>
            r.replyId === message.replyId || r.title === message.replyTitle
          );
          if (hit?.nextNodeKey) {
            await FlowRun.findByIdAndUpdate(run._id, {
              currentNodeKey: hit.nextNodeKey,
              lastActivityAt: new Date(),
            });
            return this.advanceRun(await FlowRun.findById(run._id), { kind: 'auto', text: '' });
          }
        }
      }

      // ── Collect Input ──
      if (nodeType === NODE_TYPES.COLLECT_INPUT) {
        await this.executeCollectInput(run, node, message);
        const nextKey = this.getNextNodeKey(flow, node.nodeKey);
        if (nextKey) {
          await FlowRun.findByIdAndUpdate(run._id, {
            currentNodeKey: nextKey,
            lastActivityAt: new Date(),
          });
          return this.advanceRun(await FlowRun.findById(run._id), { kind: 'auto', text: '' });
        }
      }

      // ── Unknown → fallback ──
      console.log(`[flow] no match for button on nodeType=${nodeType}, applying fallback`);
      return this.handleFallback(run, flow, node, message);
    } catch (err) {
      console.error(`[flow] handleButtonClick error:`, err);
      return { consumed: true, outcome: 'failed', error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────
  //  FALLBACK POLICY
  // ────────────────────────────────────────────────────────────
  async handleFallback(run, flow, node, message) {
    const policy = flow.fallbackPolicy || {};
    const action = policy.onUnknownReply || 'ignore';
    const maxReprompts = policy.maxReprompts || 2;

    console.log(`[flow] fallback action=${action} repromptCount=${run.repromptCount} maxReprompts=${maxReprompts}`);

    if (action === 'reprompt' && (run.repromptCount || 0) < maxReprompts) {
      await FlowRun.findByIdAndUpdate(run._id, {
        $inc: { repromptCount: 1 },
        lastActivityAt: new Date(),
      });
      console.log(`[flow] reprompt #${(run.repromptCount || 0) + 1}`);
      return { consumed: true, outcome: 'reprompted', flowRunId: run._id };
    }

    if (action === 'handoff') {
      await this.completeRun(run, 'handed_off');
      return { consumed: true, outcome: 'handed_off', flowRunId: run._id };
    }

    // 'ignore' or exhausted reprompts
    await this.completeRun(run, 'completed');
    return { consumed: true, outcome: 'completed', flowRunId: run._id };
  }

  // ────────────────────────────────────────────────────────────
  //  ADVANCE RUN — core flow engine step
  // ────────────────────────────────────────────────────────────
  async advanceRun(run, message) {
    const flow = await Flow.findById(run.flowId);
    if (!flow) {
      await FlowRun.findByIdAndUpdate(run._id, { status: 'failed', error: 'Flow not found' });
      return { consumed: true, outcome: 'failed' };
    }

    const node = flow.nodes.find(n => n.nodeKey === run.currentNodeKey);
    if (!node) {
      await this.completeRun(run, 'failed');
      return { consumed: true, outcome: 'failed' };
    }

    const nodeType = node.backendNodeType || node.nodeType;
    console.log(`[flow] advanceRun nodeKey=${node.nodeKey} nodeType=${nodeType} kind=${message.kind} lastPrompt=${run.lastPromptNodeKey}`);

    if (isTerminal(nodeType)) {
      await this.completeRun(run, nodeType === NODE_TYPES.END ? 'completed' : 'handed_off');
      return { consumed: true, outcome: nodeType === NODE_TYPES.END ? 'completed' : 'handed_off' };
    }

    if (isSuspending(nodeType)) {
      if (nodeType === NODE_TYPES.SEND_TEMPLATE) {
        if (run.lastPromptNodeKey === node.nodeKey && !this.canAdvanceFromSuspending(node, message, run)) {
          return { consumed: true, outcome: 'awaiting_input' };
        }
      } else {
        if (run.lastPromptNodeKey === node.nodeKey && !this.canAdvanceFromSuspending(node, message, run)) {
          return { consumed: true, outcome: 'awaiting_input' };
        }
      }
    }

    let nextNodeKey = null;
    let outcome = 'advanced';

    try {
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
            const outputIndex = btnIndex + 1;
            nextNodeKey = this.getNextNodeKey(flow, node.nodeKey, outputIndex);
            console.log(`[flow] SEND_TEMPLATE button: btnIndex=${btnIndex} outputIndex=${outputIndex} nextNodeKey=${nextNodeKey}`);
            await FlowRun.findByIdAndUpdate(run._id, {
              $set: { [`variables._button_${btnIndex}`]: message.replyTitle || message.replyId },
            });
          } else if (run.lastPromptNodeKey === node.nodeKey) {
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

        default:
          console.warn(`[flow] unknown nodeType=${nodeType}, advancing to next`);
          nextNodeKey = this.getNextNodeKey(flow, node.nodeKey);
          break;
      }
    } catch (err) {
      console.error(`[flow] advanceRun error at node ${node.nodeKey}:`, err.message);
      return { consumed: true, outcome: 'failed', error: err.message };
    }

    if (outcome === 'advanced' && nextNodeKey) {
      await FlowRun.findByIdAndUpdate(run._id, {
        currentNodeKey: nextNodeKey,
        lastActivityAt: new Date(),
      });

      const nextNode = flow.nodes.find(n => n.nodeKey === nextNodeKey);
      const nextType = nextNode?.backendNodeType || nextNode?.nodeType;

      if (isAutoAdvancing(nextType)) {
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
      return node.config.buttons?.some(b =>
        b.replyId === message.replyId || b.title === message.replyTitle
      );
    }

    if (nodeType === NODE_TYPES.SEND_LIST) {
      return node.config.sections?.some(s =>
        s.rows?.some(r => r.replyId === message.replyId || r.title === message.replyTitle)
      );
    }

    if (nodeType === NODE_TYPES.SEND_TEMPLATE) {
      return true;
    }

    if (nodeType === NODE_TYPES.COLLECT_INPUT) {
      return true;
    }

    return false;
  }

  getNextNodeKey(flow, currentNodeKey, outputIndex) {
    if (outputIndex !== undefined && outputIndex !== null) {
      const edge = flow.edges.find(e => e.from === currentNodeKey && e.outputIndex === outputIndex);
      if (edge) return edge.to;
    }
    const edge = flow.edges.find(e => e.from === currentNodeKey);
    return edge?.to || null;
  }

  // ────────────────────────────────────────────────────────────
  //  NODE EXECUTION
  // ────────────────────────────────────────────────────────────
  async executeSendMessage(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);

    const messageAPI = this.getMessageAPI(config.accessToken);
    const text = this.interpolateVariables(node.config.text || '', run.variables);

    console.log(`[flow] executeSendMessage to=${phone} text="${text}"`);

    const result = await messageAPI.sendText({
      phoneNumberId: config.phoneNumberId,
      to: phone,
      text,
    });

    if (!result || !result.messages) throw new Error('Text send failed');
    console.log(`[flow] executeSendMessage sent messageId=${result.messages[0].id}`);
  }

  async executeSendMedia(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);

    const messageAPI = this.getMessageAPI(config.accessToken);
    // Support both 'media' (frontend key) and 'mediaUrl' (legacy key)
    const mediaUrl = this.interpolateVariables(node.config.media || node.config.mediaUrl || '', run.variables);
    const caption = this.interpolateVariables(node.config.caption || '', run.variables);

    // Auto-detect media type from URL extension
    let mediaType = node.config.mediaType || 'image';
    if (mediaUrl.match(/\.mp4(\?|$)/i)) mediaType = 'video';
    else if (mediaUrl.match(/\.pdf(\?|$)/i)) mediaType = 'document';
    else if (mediaUrl.match(/\.(ogg|opus|mp3|wav|m4a)(\?|$)/i)) mediaType = 'audio';

    console.log(`[flow] executeSendMedia to=${phone} type=${mediaType} url=${mediaUrl}`);

    const result = await messageAPI.sendMedia({
      phoneNumberId: config.phoneNumberId,
      to: phone,
      type: mediaType,
      link: mediaUrl,
      caption,
    });

    if (!result || !result.messages) throw new Error('Media send failed');
    console.log(`[flow] executeSendMedia sent messageId=${result.messages[0].id}`);
  }

  async executeSendButtons(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);
    const phone = await this._getContactPhone(run.tenantId, run.contactId);

    const messageAPI = this.getMessageAPI(config.accessToken);

    // Support both 'media-button' (media + caption + buttons) and 'text-button' (text + buttons)
    const body = this.interpolateVariables(node.config.body || node.config.caption || '', run.variables);
    const footer = node.config.footer ? this.interpolateVariables(node.config.footer, run.variables) : null;
    const mediaUrl = node.config.media ? this.interpolateVariables(node.config.media, run.variables) : null;

    // Build header: image if media URL present, otherwise text header if provided
    let header = null;
    if (mediaUrl && mediaUrl.startsWith('http')) {
      header = { type: 'image', image: { link: mediaUrl } };
    } else if (node.config.header) {
      header = { type: 'text', text: { text: this.interpolateVariables(node.config.header, run.variables) } };
    }

    const buttons = (node.config.buttons || []).map(b => ({
      type: 'reply',
      reply: {
        id: b.replyId || b.id || `btn_${Math.random().toString(36).slice(2, 8)}`,
        title: this.interpolateVariables(b.title || '', run.variables),
      },
    }));

    console.log(`[flow] executeSendButtons to=${phone} body="${body}" media=${mediaUrl || 'none'} buttons=${buttons.length}`);

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

    if (result?.messages?.[0]?.id) {
      await FlowRun.findByIdAndUpdate(run._id, {
        lastPromptMessageId: result.messages[0].id,
      });
      console.log(`[flow] executeSendButtons sent messageId=${result.messages[0].id}`);
    }
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

    if (result?.messages?.[0]?.id) {
      await FlowRun.findByIdAndUpdate(run._id, {
        lastPromptMessageId: result.messages[0].id,
      });
    }
  }

  async executeSendTemplate(flow, run, node, message) {
    const config = await this._getConfig(run.tenantId);

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

    console.log(`[flow] executeSendTemplate template="${template.name}" to=${contact.phone}`);

    const result = await messageAPI.sendTemplate({
      phoneNumberId: config.phoneNumberId,
      to: contact.phone,
      templateName: template.name,
      language: template.language,
      ...(components.length ? { components } : {}),
    });

    if (!result || !result.messages) throw new Error('Template send failed: no message ID returned');

    const sentMessageId = result.messages[0].id;
    console.log(`[flow] executeSendTemplate sent messageId=${sentMessageId}`);

    const buttons = (template.buttons || []).map((b, i) => ({
      title: b.text,
      payload: b.payload || '',
      type: b.type,
      index: i,
    }));

    await FlowRun.findByIdAndUpdate(run._id, {
      lastPromptNodeKey: node.nodeKey,
      lastPromptMessageId: sentMessageId,
      lastActivityAt: new Date(),
      $set: { [`_templateButtons`]: buttons },
    });
  }

  // ────────────────────────────────────────────────────────────
  //  BUTTON MATCHING — payload first, then fuzzy text, then index
  // ────────────────────────────────────────────────────────────
  findTemplateButtonIndex(node, message) {
    const buttons = node.config.templateButtons || node.config.buttons || [];
    if (!buttons.length) return 0;

    const replyPayload = (message.replyId || '').trim();
    const replyText = (message.replyTitle || '').trim().toLowerCase();

    console.log(`[flow] findTemplateButtonIndex replyPayload="${replyPayload}" replyText="${replyText}" buttonCount=${buttons.length}`);

    // 1. Match on payload (authoritative if available)
    if (replyPayload) {
      const idx = buttons.findIndex(b => b.payload && b.payload.trim() === replyPayload);
      if (idx >= 0) {
        console.log(`[flow]   matched by payload at index ${idx}`);
        return idx;
      }
    }

    // 2. Match on text (case-insensitive, trimmed)
    if (replyText) {
      const idx = buttons.findIndex(b => {
        const t = (b.title || b.text || '').trim().toLowerCase();
        return t === replyText;
      });
      if (idx >= 0) {
        console.log(`[flow]   matched by text at index ${idx}`);
        return idx;
      }
    }

    // 3. Match on partial text (first 5+ chars)
    if (replyText.length >= 5) {
      const idx = buttons.findIndex(b => {
        const t = (b.title || b.text || '').trim().toLowerCase();
        return t.includes(replyText) || replyText.includes(t);
      });
      if (idx >= 0) {
        console.log(`[flow]   matched by partial text at index ${idx}`);
        return idx;
      }
    }

    console.log(`[flow]   no match found, defaulting to index 0`);
    return 0;
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
