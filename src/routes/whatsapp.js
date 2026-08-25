import { Router } from 'express';
import {
  getWaConfigController,
  saveWaConfigController,
  connectWaController,
  disconnectWaController,
  getWebhookInfoController,
  syncTemplatesController,
  listTemplatesController,
  getTemplateController,
  createTemplateController,
  updateTemplateController,
  deleteTemplateController,
  submitTemplateController,
  checkComplianceController,
  getWebhookSubscriptionController,
  subscribeWebhookController,
  sendTestTemplateController,
} from '../controllers/whatsapp.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import {
  createTemplateSchema,
  updateTemplateSchema,
  templateIdParam,
} from '../validators/whatsapp.js';

const router = Router();
router.use(authenticate);

const saveConfigSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1).optional(),          // omitted = keep stored token
    phoneNumberId: z.string().min(1).optional(),
    wabaId: z.string().min(1).optional(),
    businessAccountId: z.string().min(1).optional(),
    appSecret: z.string().min(1).optional(),            // omitted = keep stored secret
    pin: z.string().regex(/^\d{6}$/, 'PIN must be 6 digits').optional(),
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to save' }),
});

router.get('/config', getWaConfigController);
router.post('/config', validate(saveConfigSchema), saveWaConfigController);

router.post('/connect', connectWaController);
router.post('/disconnect', disconnectWaController);

router.get('/webhook-info', getWebhookInfoController);
router.get('/webhook/subscription', getWebhookSubscriptionController);
router.post('/webhook/subscription', subscribeWebhookController);

// Templates
router.post('/templates/sync', syncTemplatesController);
router.post('/templates/check-compliance', validate(createTemplateSchema), checkComplianceController);
router.get('/templates', listTemplatesController);
router.post('/templates', validate(createTemplateSchema), createTemplateController);
router.get('/templates/:id', validate(templateIdParam), getTemplateController);
router.put('/templates/:id', validate(updateTemplateSchema), updateTemplateController);
router.delete('/templates/:id', validate(templateIdParam), deleteTemplateController);
router.post('/templates/:id/submit', validate(templateIdParam), submitTemplateController);
router.post('/templates/send-test', sendTestTemplateController);

export default router;
