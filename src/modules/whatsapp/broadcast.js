import { Broadcast, BroadcastRecipient } from '../../models/index.js';
import { MessageAPI, createMessageAPI } from '../meta/index.js';
import { buildSendComponents } from '../meta/template.js';
import { normalizePhone, phoneVariants } from '../../utils/phone.js';
import { config } from '../../config/index.js';

const META_RATE_LIMITS = {
  MESSAGES_PER_SECOND: 80,
  MESSAGES_PER_MINUTE: 1000,
  DAILY_TIER_CAPS: {
    unverified: 250,
    verified_tier1: 1000,
    verified_tier2: 10000,
    verified_tier3: 100000,
  },
};

const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000;

const phoneRateLimiters = new Map();

function getPhoneRateLimiter(phoneNumberId) {
  if (!phoneRateLimiters.has(phoneNumberId)) {
    phoneRateLimiters.set(phoneNumberId, {
      tokens: META_RATE_LIMITS.MESSAGES_PER_SECOND,
      lastRefill: Date.now(),
    });
  }
  return phoneRateLimiters.get(phoneNumberId);
}

async function waitForRateLimit(phoneNumberId) {
  const limiter = getPhoneRateLimiter(phoneNumberId);
  const now = Date.now();
  const elapsed = (now - limiter.lastRefill) / 1000;
  
  if (elapsed >= 1) {
    limiter.tokens = META_RATE_LIMITS.MESSAGES_PER_SECOND;
    limiter.lastRefill = now;
  }
  
  if (limiter.tokens <= 0) {
    const waitMs = 1000 - (now - limiter.lastRefill);
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    return waitForRateLimit(phoneNumberId);
  }
  
  limiter.tokens--;
}

export class BroadcastEngine {
  constructor() {
    this.messageAPICache = new Map();
  }

  getMessageAPI(accessToken) {
    if (!this.messageAPICache.has(accessToken)) {
      this.messageAPICache.set(accessToken, createMessageAPI(accessToken));
    }
    return this.messageAPICache.get(accessToken);
  }

  async enqueueBroadcast(broadcastId) {
    const broadcast = await Broadcast.findById(broadcastId).populate('templateId');
    if (!broadcast) throw new Error('Broadcast not found');
    
    if (broadcast.status !== 'scheduled' && broadcast.status !== 'draft') {
      throw new Error(`Cannot start broadcast in status: ${broadcast.status}`);
    }
    
    if (broadcast.templateId.status !== 'APPROVED') {
      throw new Error('Template must be APPROVED to send broadcast');
    }
    
    await this.buildRecipients(broadcast);
    
    await Broadcast.findByIdAndUpdate(broadcastId, { 
      status: 'sending', 
      startedAt: new Date() 
    });
    
    return this.processBroadcast(broadcastId);
  }

  async buildRecipients(broadcast) {
    let contactIds = [];
    
    if (broadcast.audience.type === 'list') {
      contactIds = broadcast.audience.contactIds || [];
    } else if (broadcast.audience.type === 'tags') {
      const contacts = await Contact.find({ 
        tenantId: broadcast.tenantId, 
        tags: { $in: broadcast.audience.tagIds },
        optInStatus: 'opted_in',
      }).select('_id');
      contactIds = contacts.map(c => c._id);
    } else if (broadcast.audience.type === 'all') {
      const contacts = await Contact.find({ 
        tenantId: broadcast.tenantId,
        optInStatus: 'opted_in',
      }).select('_id');
      contactIds = contacts.map(c => c._id);
    }
    
    const contacts = await Contact.find({ _id: { $in: contactIds } }).select('_id phone name');
    
    const recipients = contacts.map(contact => {
      const vars = broadcast.variables?.find(v => v.contactId?.toString() === contact._id.toString()) || {};
      return {
        broadcastId: broadcast._id,
        contactId: contact._id,
        phone: normalizePhone(contact.phone),
        variables: {
          body: vars.body || [],
          header: vars.header,
          buttons: vars.buttons,
        },
        status: 'pending',
      };
    });
    
    if (recipients.length === 0) {
      throw new Error('No valid recipients found');
    }
    
    await BroadcastRecipient.insertMany(recipients);
    
    await Broadcast.findByIdAndUpdate(broadcast._id, { 
      'stats.total': recipients.length 
    });
    
    return recipients;
  }

  async processBroadcast(broadcastId) {
    const broadcast = await Broadcast.findById(broadcastId).populate('templateId');
    if (!broadcast) return;
    
    const pendingRecipients = await BroadcastRecipient.find({ 
      broadcastId, 
      status: 'pending' 
    }).limit(BATCH_SIZE * 4);
    
    if (pendingRecipients.length === 0) {
      await this.completeBroadcast(broadcastId);
      return;
    }
    
    const messageAPI = this.getMessageAPI(broadcast.whatsappConfig?.accessToken);
    
    for (let i = 0; i < pendingRecipients.length; i += BATCH_SIZE) {
      const batch = pendingRecipients.slice(i, i + BATCH_SIZE);
      
      if (!broadcast.whatsappConfig?.isInProcessingWindow()) {
        const nextWindow = broadcast.whatsappConfig?.getNextWindowStart();
        const delay = nextWindow.getTime() - Date.now();
        console.log(`Outside processing window, rescheduling in ${Math.round(delay / 60000)} min`);
        setTimeout(() => this.processBroadcast(broadcastId), delay);
        return;
      }
      
      await Promise.all(batch.map(recipient => this.sendToRecipient(broadcast, recipient, messageAPI)));
      
      if (i + BATCH_SIZE < pendingRecipients.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
    
    const remaining = await BroadcastRecipient.countDocuments({ broadcastId, status: 'pending' });
    if (remaining > 0) {
      setImmediate(() => this.processBroadcast(broadcastId));
    } else {
      await this.completeBroadcast(broadcastId);
    }
  }

  async sendToRecipient(broadcast, recipient, messageAPI) {
    const template = broadcast.templateId;
    const phoneNumberId = broadcast.phoneNumberId || broadcast.whatsappConfig?.phoneNumberId;
    
    if (!phoneNumberId) {
      await this.updateRecipient(recipient._id, { 
        status: 'failed', 
        errorMessage: 'No phone number configured' 
      });
      return;
    }
    
    await waitForRateLimit(phoneNumberId);
    
    try {
      const components = buildSendComponents(template, recipient.variables);
      
      const result = await messageAPI.sendTemplate({
        phoneNumberId,
        to: recipient.phone,
        templateName: template.name,
        language: template.language,
        components,
        idempotencyKey: `broadcast-${broadcast._id}-${recipient._id}`,
      });
      
      if (result.success) {
        await this.updateRecipient(recipient._id, { 
          status: 'sent', 
          metaMessageId: result.messageId,
          sentAt: new Date(),
        });
        await Broadcast.findByIdAndUpdate(broadcast._id, { 
          $inc: { 'stats.sent': 1 } 
        });
      } else {
        await this.handleSendError(recipient, broadcast, result);
      }
    } catch (error) {
      await this.handleSendError(recipient, broadcast, { 
        error: error.message, 
        errorCode: error.code 
      });
    }
  }

  async handleSendError(recipient, broadcast, result) {
    const errorCode = result.errorCode || 'UNKNOWN_ERROR';
    const isRetryable = errorCode === '131009'; // Rate limited
    
    if (isRetryable && recipient.retryCount < 3) {
      await BroadcastRecipient.findByIdAndUpdate(recipient._id, { 
        $inc: { retryCount: 1 },
        status: 'pending',
      });
    } else {
      let status = 'failed';
      if (errorCode === '131026' || errorCode === '131047') status = 'skipped';
      
      await this.updateRecipient(recipient._id, { 
        status, 
        errorCode, 
        errorMessage: result.error,
        sentAt: new Date(),
      });
      
      await Broadcast.findByIdAndUpdate(broadcast._id, { 
        $inc: { 'stats.failed': 1 } 
      });
    }
  }

  async updateRecipient(id, data) {
    await BroadcastRecipient.findByIdAndUpdate(id, data);
  }

  async completeBroadcast(broadcastId) {
    const broadcast = await Broadcast.findById(broadcastId);
    if (!broadcast) return;
    
    const stats = await BroadcastRecipient.aggregate([
      { $match: { broadcastId: broadcast._id } },
      { $group: { 
        _id: '$status', 
        count: { $sum: 1 } 
      }}
    ]);
    
    const statMap = Object.fromEntries(stats.map(s => [s._id, s.count]));
    
    await Broadcast.findByIdAndUpdate(broadcastId, { 
      status: 'completed',
      completedAt: new Date(),
      'stats.sent': statMap.sent || 0,
      'stats.delivered': statMap.delivered || 0,
      'stats.read': statMap.read || 0,
      'stats.failed': (statMap.failed || 0) + (statMap.skipped || 0),
    });
  }

  async pauseBroadcast(broadcastId) {
    await Broadcast.findByIdAndUpdate(broadcastId, { status: 'paused' });
  }

  async resumeBroadcast(broadcastId) {
    const broadcast = await Broadcast.findById(broadcastId);
    if (!broadcast || broadcast.status !== 'paused') return;
    
    await Broadcast.findByIdAndUpdate(broadcastId, { status: 'sending' });
    return this.processBroadcast(broadcastId);
  }

  async getBroadcastStats(broadcastId) {
    const stats = await BroadcastRecipient.aggregate([
      { $match: { broadcastId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    return Object.fromEntries(stats.map(s => [s._id, s.count]));
  }
}

export const broadcastEngine = new BroadcastEngine();