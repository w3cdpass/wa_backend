import { Router } from 'express';
import {
  getWaConfigController,
  saveWaConfigController,
  connectWaController,
  disconnectWaController,
  getWebhookInfoController,
  syncTemplatesController,
  listTemplatesController,
} from '../controllers/whatsapp.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const saveConfigSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1, 'Access token is required'),
    phoneNumberId: z.string().min(1, 'Phone Number ID is required'),
    wabaId: z.string().min(1).optional(),
    businessAccountId: z.string().min(1).optional(),
    appSecret: z.string().min(1).optional(),
    pin: z.string().regex(/^\d{6}$/, 'PIN must be 6 digits').optional(),
  }),
});

router.get('/config', getWaConfigController);
router.post('/config', validate(saveConfigSchema), saveWaConfigController);

router.post('/connect', connectWaController);
router.post('/disconnect', disconnectWaController);

router.get('/webhook-info', getWebhookInfoController);

// Templates
router.post('/templates/sync', syncTemplatesController);
router.get('/templates', listTemplatesController);

export default router;
