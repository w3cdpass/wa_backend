import { Router } from 'express';
import {
  runScheduledNowController,
  scheduleCampaignController,
  updateScheduleController,
  cancelScheduleController,
  listScheduledCampaignsController,
} from '../controllers/campaigns.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { campaignIdParam, scheduleCampaignSchema } from '../validators/campaigns.js';

const router = Router();
router.use(authenticate);

router.get('/', listScheduledCampaignsController);

router.post('/:campaignId/schedule', validate(scheduleCampaignSchema), scheduleCampaignController);
router.put('/:campaignId/schedule', validate(scheduleCampaignSchema), updateScheduleController);
router.delete('/:campaignId/schedule', validate({ params: scheduleCampaignSchema.shape.params }), cancelScheduleController);
router.post('/:campaignId/run-now', validate(campaignIdParam), runScheduledNowController);

export default router;