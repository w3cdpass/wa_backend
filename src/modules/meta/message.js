import { MetaClient, MetaAPIError } from './client.js';
import axios from 'axios';

const META_API_VERSION = process.env.META_API_VERSION || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export class MessageAPI {
  constructor(metaClient) {
    this.client = metaClient;
  }

  async sendTemplate({ phoneNumberId, to, templateName, language = 'en_US', components, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');
    
    const templatePayload = {
      name: templateName,
      language: { code: language },
    };

    if (components && components.length > 0) {
      templatePayload.components = components;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'template',
      template: templatePayload,
    };

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async sendText({ phoneNumberId, to, text, previewUrl = false, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');
    
    const payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body: text, preview_url: previewUrl },
    };

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async sendMedia({ phoneNumberId, to, type, link, caption, filename, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');

    let mediaObj = {};
    if (link && link.startsWith('data:')) {
      const mediaId = await this.uploadMediaBuffer(phoneNumberId, link);
      mediaObj = { id: mediaId };
    } else {
      mediaObj = { link };
    }
    if (caption) mediaObj.caption = caption;
    if (filename) mediaObj.filename = filename;

    const payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type,
      [type]: mediaObj,
    };

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async uploadMediaBuffer(phoneNumberId, dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    const filename = `media_${Date.now()}.${ext}`;

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);

    const response = await axios.post(
      `${META_API_BASE}/${phoneNumberId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${this.client.accessToken}`,
        },
        timeout: 30000,
      }
    );

    if (!response.data?.id) throw new Error('Media upload failed: no ID returned');
    return response.data.id;
  }

  async sendInteractive({ phoneNumberId, to, type, body, header, footer, action, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');
    
    const payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'interactive',
      interactive: { type },
    };

    if (type === 'button') {
      payload.interactive.body = { text: body };
      if (header) payload.interactive.header = header;
      if (footer) payload.interactive.footer = footer;
      payload.interactive.action = { buttons: action };
    } else if (type === 'list') {
      payload.interactive.body = { text: body };
      if (header) payload.interactive.header = header;
      if (footer) payload.interactive.footer = footer;
      payload.interactive.action = { button: action.button, sections: action.sections };
    } else if (type === 'product' || type === 'product_list') {
      payload.interactive.body = { text: body };
      if (footer) payload.interactive.footer = footer;
      payload.interactive.action = action;
    }

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async sendLocation({ phoneNumberId, to, latitude, longitude, name, address, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');
    
    const payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'location',
      location: { latitude, longitude, name, address },
    };

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async sendContacts({ phoneNumberId, to, contacts, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');
    
    const payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'contacts',
      contacts,
    };

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async sendReaction({ phoneNumberId, to, messageId, emoji, idempotencyKey }) {
    const client = this.client;
    const cleanTo = to.replace(/[^\d]/g, '');
    
    const payload = {
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'reaction',
      reaction: { message_id: messageId, emoji },
    };

    return client.post(`/${phoneNumberId}/messages`, payload, { idempotencyKey });
  }

  async getMessageStatus(messageId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.get(`/${messageId}`);
  }

  async markRead(phoneNumberId, messageId) {
    const client = this.client;
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };
    return client.post(`/${phoneNumberId}/messages`, payload);
  }

  async deleteMessage(messageId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.delete(`/${messageId}`);
  }
}

export function createMessageAPI(accessToken) {
  const client = new MetaClient(accessToken);
  return new MessageAPI(client);
}