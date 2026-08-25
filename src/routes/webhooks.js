import { Router } from 'express';
import crypto from 'crypto';
import { WhatsAppConfig } from '../models/WhatsAppConfig.js';
import { WebhookEvent } from '../models/WebhookEvent.js';
import { webhookHandler } from '../modules/whatsapp/webhook.js';
import { decrypt } from '../utils/encryption.js';
import { config } from '../config/index.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe' || !token) {
      return res.status(403).send('Forbidden');
    }

    const waConfig = await WhatsAppConfig.findOne({ verifyToken: token }).select('tenantId');

    if (!waConfig) {
      return res.status(403).send('Forbidden');
    }

    await WebhookEvent.create({
      tenantId: waConfig.tenantId,
      type: 'webhook_verified',
      payload: { mode },
      processed: true,
    });

    return res.status(200).send(challenge);
  } catch (error) {
    console.error('Webhook verification error:', error);
    return res.status(403).send('Forbidden');
  }
});

router.post('/', async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const phoneNumberId = value?.metadata?.phone_number_id;

    let waConfig = null;
    if (phoneNumberId) {
      waConfig = await WhatsAppConfig.findOne({ phoneNumberId });
    }
    // Message/message-status events carry metadata.phone_number_id, but
    // account-level events like message_template_status_update do NOT —
    // they can only be attributed via entry.id (= WABA ID).
    if (!waConfig) {
      const wabaId = req.body?.entry?.[0]?.id;
      if (wabaId) waConfig = await WhatsAppConfig.findOne({ wabaId });
    }
    if (!waConfig && tokenFromQuery(req)) {
      waConfig = await WhatsAppConfig.findOne({ verifyToken: tokenFromQuery(req) });
    }

    const signature = req.headers['x-hub-signature-256'];
    if (signature) {
      const secret = waConfig?.appSecretEnc
        ? decrypt(waConfig.appSecretEnc)
        : process.env.META_APP_SECRET;

      if (secret) {
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.status(403).json({ error: 'Invalid signature' });
        }
      }
    }

    const tenantId = waConfig?.tenantId;
    if (!tenantId) {
      return res.status(200).json({ status: 'ignored', reason: 'Unknown phone number' });
    }

    await webhookHandler.processWebhook(tenantId.toString(), req.body);
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(200).json({ status: 'ok' });
  }
});

function tokenFromQuery(req) {
  return req.query['hub.verify_token'];
}

export default router;

export const webhookMountPath = config.webhookPath;
