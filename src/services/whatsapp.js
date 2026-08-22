import axios from 'axios';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

const META_API_BASE = `https://graph.facebook.com/${config.whatsapp.meta.apiVersion}`;

export class WhatsAppService {
  constructor() {
    this.accessToken = config.whatsapp.meta.accessToken;
    this.phoneNumberId = config.whatsapp.meta.phoneNumberId;
    this.appSecret = config.whatsapp.meta.appSecret;
  }

  async sendTextMessage(to, body) {
    return this.sendMessage(to, {
      type: 'text',
      text: { body },
    });
  }

  async sendImageMessage(to, imageUrl, caption) {
    return this.sendMessage(to, {
      type: 'image',
      image: { link: imageUrl, caption },
    });
  }

  async sendVideoMessage(to, videoUrl, caption) {
    return this.sendMessage(to, {
      type: 'video',
      video: { link: videoUrl, caption },
    });
  }

  async sendDocumentMessage(to, documentUrl, filename, caption) {
    return this.sendMessage(to, {
      type: 'document',
      document: { link: documentUrl, filename, caption },
    });
  }

  async sendMessage(to, messagePayload) {
    if (!this.accessToken || !this.phoneNumberId) {
      throw new AppError('WhatsApp credentials not configured', 503);
    }

    const cleanTo = to.replace(/[^\d]/g, '');
    const url = `${META_API_BASE}/${this.phoneNumberId}/messages`;

    try {
      const response = await axios.post(url, {
        messaging_product: 'whatsapp',
        to: cleanTo,
        ...messagePayload,
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: true,
        messageId: response.data.messages?.[0]?.id,
        data: response.data,
      };
    } catch (error) {
      console.error('WhatsApp send error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        errorCode: error.response?.data?.error?.code,
        data: error.response?.data,
      };
    }
  }

  async getMessageStatus(messageId) {
    if (!this.accessToken) throw new AppError('WhatsApp not configured', 503);

    try {
      const response = await axios.get(`${META_API_BASE}/${messageId}`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });
      return response.data;
    } catch (error) {
      return { error: error.message };
    }
  }

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === this.appSecret) {
      return challenge;
    }
    return null;
  }

  parseWebhook(body) {
    const results = [];
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.messages) {
        for (const msg of value.messages) {
          results.push({
            messageId: msg.id,
            from: msg.from,
            timestamp: msg.timestamp,
            type: msg.type,
            text: msg.text?.body,
            image: msg.image,
            video: msg.video,
            document: msg.document,
          });
        }
      }

      if (value?.statuses) {
        for (const status of value.statuses) {
          results.push({
            messageId: status.id,
            status: status.status,
            timestamp: status.timestamp,
            recipientId: status.recipient_id,
            pricing: status.pricing,
          });
        }
      }
    } catch (e) {
      console.error('Webhook parse error:', e);
    }
    return results;
  }

  isInProcessingWindow() {
    const now = new Date();
    const tz = config.processingWindow.timezone;
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const hour = localTime.getHours();
    const day = localTime.getDay();
    return day >= 1 && day <= 5 && hour >= config.processingWindow.startHour && hour < config.processingWindow.endHour;
  }

  getNextWindowStart() {
    const now = new Date();
    const tz = config.processingWindow.timezone;
    let localTime = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const hour = localTime.getHours();
    const day = localTime.getDay();

    if (day === 0) {
      localTime.setDate(localTime.getDate() + 1);
    } else if (day === 6) {
      localTime.setDate(localTime.getDate() + 2);
    } else if (hour < config.processingWindow.startHour) {
      // Same day
    } else if (hour >= config.processingWindow.endHour) {
      localTime.setDate(localTime.getDate() + 1);
      if (localTime.getDay() === 6) localTime.setDate(localTime.getDate() + 2);
    }

    localTime.setHours(config.processingWindow.startHour, 0, 0, 0);
    return localTime;
  }
}

export const whatsappService = new WhatsAppService();