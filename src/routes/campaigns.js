import { Router } from 'express';
import {
  createCampaignController,
  listCampaignsController,
  getCampaignController,
  updateCampaignController,
  deleteCampaignController,
  startCampaignController,
  pauseCampaignController,
  resumeCampaignController,
  cancelCampaignController,
  getCampaignStatusController,
  previewRecipientsController,
  runScheduledNowController,
  scheduleCampaignController,
  updateScheduleController,
  cancelScheduleController,
  listScheduledCampaignsController,
  getDashboardSummaryController,
  getPerformanceChartController,
  getRecentActivityController,
} from '../controllers/campaigns.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createCampaignSchema, updateCampaignSchema, campaignIdParam, listCampaignsSchema, scheduleCampaignSchema, previewRecipientsSchema } from '../validators/campaigns.js';

const router = Router();
router.use(authenticate);

router.get('/summary', getDashboardSummaryController);
router.get('/performance', getPerformanceChartController);
router.get('/activity', getRecentActivityController);

router.get('/', validate(listCampaignsSchema), listCampaignsController);
router.post('/', validate(createCampaignSchema), createCampaignController);
router.get('/scheduled', listScheduledCampaignsController);
router.post('/preview-recipients', validate(previewRecipientsSchema), previewRecipientsController);

router.get('/:id', validate(campaignIdParam), getCampaignController);
router.put('/:id', validate(updateCampaignSchema), updateCampaignController);
router.delete('/:id', validate(campaignIdParam), deleteCampaignController);

router.post('/:id/start', validate(campaignIdParam), startCampaignController);
router.post('/:id/pause', validate(campaignIdParam), pauseCampaignController);
router.post('/:id/resume', validate(campaignIdParam), resumeCampaignController);
router.post('/:id/cancel', validate(campaignIdParam), cancelCampaignController);
router.get('/:id/status', validate(campaignIdParam), getCampaignStatusController);

router.post('/:campaignId/schedule', validate(scheduleCampaignSchema), scheduleCampaignController);
router.put('/:campaignId/schedule', validate(scheduleCampaignSchema), updateScheduleController);
router.delete('/:campaignId/schedule', validate({ params: scheduleCampaignSchema.shape.params }), cancelScheduleController);
router.post('/:campaignId/run-now', validate(campaignIdParam), runScheduledNowController);

export default router;