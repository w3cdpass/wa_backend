import { Conversation, Message, Contact, WhatsAppConfig } from '../../models/index.js';
import { MessageAPI, createMessageAPI } from '../meta/index.js';
import { buildSendComponents } from '../meta/template.js';
import { normalizePhone } from '../../utils/phone.js';

export class InboxService {
  constructor() {
    this.messageAPICache = new Map();
  }

  getMessageAPI(accessToken) {
    if (!this.messageAPICache.has(accessToken)) {
      this.messageAPICache.set(accessToken, createMessageAPI(accessToken));
    }
    return this.messageAPICache.get(accessToken);
  }

  async getConversations(tenantId, filters = {}, pagination = {}) {
    const { page = 1, limit = 20 } = pagination;
    const query = { tenantId };
    
    if (filters.status) query.status = filters.status;
    if (filters.assignedTo) query.assignedTo = filters.assignedTo;
    if (filters.unreadOnly) query.unreadCount = { $gt: 0 };
    
    const conversations = await Conversation.find(query)
      .populate('contactId')
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    const total = await Conversation.countDocuments(query);
    
    return { conversations, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getConversation(conversationId, tenantId) {
    return Conversation.findOne({ _id: conversationId, tenantId })
      .populate('contactId')
      .populate('assignedTo', 'name email');
  }

  async getMessages(conversationId, tenantId, pagination = {}) {
    const { page = 1, limit = 50, before } = pagination;
    const query = { conversationId, tenantId };
    
    if (before) query.createdAt = { $lt: new Date(before) };
    
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    const total = await Message.countDocuments(query);
    
    return { messages: messages.reverse(), total, page, limit };
  }

  async sendMessage(tenantId, data) {
    const { conversationId, contactId, type, text, mediaUrl, mediaType, mediaCaption, templateId, templateParams } = data;
    
    const conversation = await Conversation.findOne({ _id: conversationId, tenantId });
    if (!conversation) throw new Error('Conversation not found');
    
    const config = await WhatsAppConfig.findOne({ tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    
    const messageAPI = this.getMessageAPI(config.accessToken);
    const phoneNumberId = config.phoneNumberId;
    const to = conversation.contactId; // This needs to be the phone number
    
    let result;
    const baseParams = { phoneNumberId, to };
    
    if (type === 'template' && templateId) {
      const Template = (await import('../../models/Template.js')).Template;
      const template = await Template.findById(templateId);
      if (!template) throw new Error('Template not found');
      
      const components = buildSendComponents(template, templateParams);
      
      result = await this.getMessageAPI(config.accessToken).sendTemplate({
        ...baseParams,
        templateName: template.name,
        language: template.language,
        components,
      });
    } else if (type === 'text') {
      result = await this.getMessageAPI(config.accessToken).sendText({
        ...baseParams,
        text,
      });
    } else if (['image', 'video', 'document'].includes(type)) {
      result = await this.getMessageAPI(config.accessToken).sendMedia({
        ...baseParams,
        type,
        link: mediaUrl,
        caption: mediaCaption,
      });
    } else {
      throw new Error(`Unsupported message type: ${type}`);
    }
    
    if (!result.success) {
      const message = await Message.create({
        tenantId,
        conversationId,
        contactId,
        direction: 'outbound',
        contentType: type,
        contentText: text,
        mediaUrl,
        mediaType,
        mediaCaption,
        templateId,
        templateParams,
        status: 'failed',
        errorCode: result.errorCode,
        errorMessage: result.error,
        sentBy: data.sentBy,
      });
      
      throw new Error(result.error || 'Failed to send message');
    }
    
    const message = await Message.create({
      tenantId,
      conversationId,
      contactId,
      direction: 'outbound',
      contentType: type,
      contentText: text,
      mediaUrl,
      mediaType,
      mediaCaption,
      templateId,
      templateParams,
      status: 'sent',
      metaMessageId: result.messageId,
      sentAt: new Date(),
      sentBy: data.sentBy,
    });
    
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessageText: text || `[${type}]`,
      lastMessageAt: new Date(),
      status: 'open',
      unreadCount: 0,
    });
    
    return { message, metaMessageId: result.messageId };
  }

  async markAsRead(conversationId, tenantId) {
    await Conversation.findOneAndUpdate(
      { _id: conversationId, tenantId },
      { $set: { unreadCount: 0 } }
    );
  }

  async assignConversation(conversationId, tenantId, userId) {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, tenantId },
      { $set: { assignedTo: userId } },
      { new: true }
    );
  }

  async closeConversation(conversationId, tenantId) {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, tenantId },
      { $set: { status: 'closed' } },
      { new: true }
    );
  }

  async reopenConversation(conversationId, tenantId) {
    return Conversation.findOneAndUpdate(
      { _id: conversationId, tenantId },
      { $set: { status: 'open' } },
      { new: true }
    );
  }

  async snoozeConversation(conversationId, tenantId, durationMinutes) {
    const until = new Date(Date.now() + durationMinutes * 60000);
    return Conversation.findOneAndUpdate(
      { _id: conversationId, tenantId },
      { $set: { status: 'snoozed', snoozedUntil: until } },
      { new: true }
    );
  }

  async addContactTag(tenantId, contactId, tag) {
    return Contact.findOneAndUpdate(
      { _id: contactId, tenantId },
      { $addToSet: { tags: tag } },
      { new: true }
    );
  }

  async removeContactTag(tenantId, contactId, tag) {
    return Contact.findOneAndUpdate(
      { _id: contactId, tenantId },
      { $pull: { tags: tag } },
      { new: true }
    );
  }

  async createContact(tenantId, data) {
    return Contact.create({ tenantId, ...data, phone: normalizePhone(data.phone) });
  }

  async updateContact(contactId, tenantId, data) {
    return Contact.findOneAndUpdate(
      { _id: contactId, tenantId },
      { $set: data },
      { new: true }
    );
  }

  async deleteContact(contactId, tenantId) {
    return Contact.findOneAndDelete({ _id: contactId, tenantId });
  }

  async getContact(contactId, tenantId) {
    return Contact.findOne({ _id: contactId, tenantId });
  }

  async searchContacts(tenantId, query, limit = 20) {
    return Contact.find({
      tenantId,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { phone: { $regex: query } },
      ],
    }).limit(limit);
  }
}

export const inboxService = new InboxService();