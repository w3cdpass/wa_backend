import crypto from 'crypto';
import { WebhookEvent } from '../../models/WebhookEvent.js';
import { Contact } from '../../models/Contact.js';
import { Conversation } from '../../models/Conversation.js';
import { Message } from '../../models/Message.js';
import { BroadcastRecipient } from '../../models/BroadcastRecipient.js';
import { Broadcast } from '../../models/Broadcast.js';
import { Template } from '../../models/Template.js';
import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { flowEngine } from './flow.js';
import { inboxService } from './inbox.js';
import { normalizePhone, phoneVariants } from '../../utils/phone.js';

export class WebhookHandler {
  constructor() {
    this.processors = {
      message: this.processMessage.bind(this),
      status: this.processStatus.bind(this),
      template: this.processTemplate.bind(this),
      quality: this.processQuality.bind(this),
      phone_number: this.processPhoneNumber.bind(this),
      account_update: this.processAccountUpdate.bind(this),
    };
  }

  verifyWebhook(mode, token, challenge, appSecret) {
    if (mode === 'subscribe' && token === appSecret) {
      return challenge;
    }
    return null;
  }

  async handleWebhook(req, res, tenantId) {
    const signature = req.headers['x-hub-signature-256'];
    const appSecret = process.env.META_APP_SECRET;
    
    if (appSecret && signature) {
      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }
    
    if (req.method === 'GET') {
      const challenge = this.verifyWebhook(
        req.query['hub.mode'],
        req.query['hub.verify_token'],
        req.query['hub.challenge'],
        appSecret
      );
      if (challenge) return res.send(challenge);
      return res.status(403).send('Forbidden');
    }
    
    try {
      await this.processWebhook(tenantId, req.body);
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }

  async processWebhook(tenantId, body) {
    const entry = body.entry?.[0];
    if (!entry) return;
    
    const changes = entry.changes?.[0];
    if (!changes) return;
    
    const value = changes.value;
    if (!value) return;
    
    const webhookEvent = await WebhookEvent.create({
      tenantId,
      type: changes.field,
      metaEventId: entry.id,
      payload: body,
      processed: false,
    });
    
    try {
      if (value.messages) {
        for (const msg of value.messages) {
          await this.processors.message(tenantId, value, msg);
        }
      }
      
      if (value.statuses) {
        for (const status of value.statuses) {
          await this.processors.status(tenantId, value, status);
        }
      }
      
      if (value.template) {
        await this.processors.template(tenantId, value.template);
      }
      
      await WebhookEvent.findByIdAndUpdate(webhookEvent._id, { processed: true });
    } catch (error) {
      await WebhookEvent.findByIdAndUpdate(webhookEvent._id, { 
        processed: true, 
        error: error.message 
      });
      throw error;
    }
  }

  async processMessage(tenantId, value, msg) {
    const phoneNumberId = value.metadata?.phone_number_id;
    const from = normalizePhone(msg.from);
    const metaMessageId = msg.id;
    const timestamp = new Date(parseInt(msg.timestamp) * 1000);
    
    let contact = await Contact.findOne({ tenantId, phone: from });
    if (!contact) {
      contact = await Contact.create({
        tenantId,
        phone: from,
        name: msg.contacts?.[0]?.profile?.name,
        source: 'webhook',
      });
    }
    
    let conversation = await Conversation.findOne({ tenantId, contactId: contact._id });
    if (!conversation) {
      conversation = await Conversation.create({
        tenantId,
        contactId: contact._id,
        phoneNumberId,
        status: 'open',
        lastMessageAt: timestamp,
      });
    }
    
    const existingMessage = await Message.findOne({ metaMessageId, tenantId });
    if (existingMessage) return;
    
    let contentText = null;
    let contentType = msg.type;
    let mediaUrl = null;
    let mediaType = null;
    let mediaSize = null;
    let mediaCaption = null;
    let interactiveReplyId = null;
    
    switch (msg.type) {
      case 'text':
        contentText = msg.text?.body;
        break;
      case 'image':
        mediaUrl = msg.image?.link;
        mediaType = 'image';
        mediaCaption = msg.image?.caption;
        break;
      case 'video':
        mediaUrl = msg.video?.link;
        mediaType = 'video';
        mediaCaption = msg.video?.caption;
        break;
      case 'document':
        mediaUrl = msg.document?.link;
        mediaType = 'document';
        mediaCaption = msg.document?.caption;
        break;
      case 'audio':
        mediaUrl = msg.audio?.link;
        mediaType = 'audio';
        break;
      case 'interactive':
        contentType = 'interactive';
        if (msg.interactive?.type === 'button_reply') {
          interactiveReplyId = msg.interactive.button_reply.id;
          contentText = msg.interactive.button_reply.title;
        } else if (msg.interactive?.type === 'list_reply') {
          interactiveReplyId = msg.interactive.list_reply.id;
          contentText = msg.interactive.list_reply.title;
        }
        break;
      case 'location':
        contentType = 'location';
        break;
      case 'template':
        contentType = 'template';
        break;
    }
    
    const message = await Message.create({
      tenantId,
      conversationId: conversation._id,
      contactId: contact._id,
      direction: 'inbound',
      contentType,
      contentText,
      mediaUrl,
      mediaType,
      mediaSize,
      mediaCaption,
      metaMessageId,
      status: 'delivered',
      interactiveReplyId,
      createdAt: timestamp,
    });
    
    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessageText: contentText || `[${msg.type}]`,
      lastMessageAt: timestamp,
      unreadCount: { $inc: 1 },
      status: 'open',
    });
    
    const config = await WhatsAppConfig.findOne({ tenantId });
    const isFirstInbound = await Message.countDocuments({ 
      conversationId: conversation._id, 
      direction: 'inbound' 
    }) === 1;
    
    const flowInput = {
      tenantId,
      contactId: contact._id,
      conversationId: conversation._id,
      message: interactiveReplyId
        ? { kind: 'interactive_reply', replyId: interactiveReplyId, replyTitle: contentText, metaMessageId }
        : { kind: 'text', text: contentText || '', metaMessageId },
      isFirstInbound,
    };
    
    await flowEngine.dispatchInbound(flowInput);
    
    await this.updateBroadcastRecipientStatus(tenantId, contact._id, metaMessageId, 'delivered');
  }

  async processStatus(tenantId, value, status) {
    const metaMessageId = status.id;
    const messageStatus = status.status;
    const timestamp = new Date(parseInt(status.timestamp) * 1000);
    
    await Message.findOneAndUpdate(
      { metaMessageId, tenantId },
      { 
        status: messageStatus,
        [`${messageStatus}At`]: timestamp,
      }
    );
    
    await BroadcastRecipient.findOneAndUpdate(
      { metaMessageId, tenantId },
      { 
        status: messageStatus,
        [`${messageStatus}At`]: timestamp,
      }
    );
    
    const message = await Message.findOne({ metaMessageId, tenantId });
    if (message) {
      await Conversation.findByIdAndUpdate(message.conversationId, {
        lastMessageAt: timestamp,
      });
    }
    
    await this.updateBroadcastStats(tenantId, metaMessageId, messageStatus);
  }

  async processTemplate(tenantId, templateData) {
    const { id, name, language, status, category, components, quality_score } = templateData;
    
    await Template.findOneAndUpdate(
      { metaTemplateId: id, tenantId },
      { 
        $set: { 
          status,
          qualityScore: quality_score?.score || null,
          components,
          updatedAt: new Date(),
        } 
      },
      { upsert: true }
    );
  }

  async processQuality(tenantId, qualityData) {
    const { phone_number_id, score, timestamp } = qualityData;
    
    await WhatsAppConfig.findOneAndUpdate(
      { tenantId, phoneNumberId: phone_number_id },
      { 
        $set: { 
          qualityRating: score?.toUpperCase(),
          lastQualityCheckAt: new Date(parseInt(timestamp) * 1000),
        } 
      }
    );
  }

  async processPhoneNumber(tenantId, phoneData) {
    const { phone_number_id, display_phone_number, verified_name, quality_rating } = phoneData;
    
    await WhatsAppConfig.findOneAndUpdate(
      { tenantId, phoneNumberId: phone_number_id },
      { 
        $set: { 
          displayPhoneNumber: display_phone_number,
          verifiedName: verified_name,
          qualityRating: quality_rating?.toUpperCase(),
        } 
      }
    );
  }

  async processAccountUpdate(tenantId, accountData) {
    console.log('Account update:', accountData);
  }

  async updateBroadcastRecipientStatus(tenantId, contactId, metaMessageId, status) {
    await BroadcastRecipient.findOneAndUpdate(
      { tenantId, contactId, metaMessageId },
      { status, [`${status}At`]: new Date() }
    );
  }

  async updateBroadcastStats(tenantId, metaMessageId, messageStatus) {
    const recipient = await BroadcastRecipient.findOne({ metaMessageId, tenantId });
    if (!recipient) return;
    
    const broadcast = await Broadcast.findById(recipient.broadcastId);
    if (!broadcast) return;
    
    const updates = {};
    if (messageStatus === 'delivered') updates['stats.delivered'] = 1;
    if (messageStatus === 'read') updates['stats.read'] = 1;
    
    if (Object.keys(updates).length > 0) {
      await Broadcast.findByIdAndUpdate(broadcast._id, { 
        $inc: updates 
      });
    }
  }
}

export const webhookHandler = new WebhookHandler();