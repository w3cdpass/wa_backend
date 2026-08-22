import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  updateCampaignStatus,
  runScheduledNow,
  setCampaignSchedule,
  cancelSchedule,
  getCampaignStatus,
  previewRecipients,
  getScheduledCampaigns,
  getDashboardSummary,
  getPerformanceChart,
  getRecentActivity,
} from '../services/campaigns.js';
import { AppError } from '../middleware/errorHandler.js';
import { enqueueCampaign } from '../services/queue.js';

export const createCampaignController = async (req, res, next) => {
  try {
    const campaign = await createCampaign(req.tenantId, req.user.id, req.body);
    
    if (campaign.status === 'processing') {
      await enqueueCampaign(campaign.id, req.tenantId);
    }
    
    res.status(201).json(campaign);
  } catch (error) {
    next(error);
  }
};

export const listCampaignsController = async (req, res, next) => {
  try {
    const { page, limit, status, search, type } = req.query;
    const result = await listCampaigns(req.tenantId, { page, limit, status, search, type });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getCampaignController = async (req, res, next) => {
  try {
    const campaign = await getCampaignById(req.tenantId, req.params.id);
    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

export const updateCampaignController = async (req, res, next) => {
  try {
    const campaign = await updateCampaign(req.tenantId, req.params.id, req.body);
    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

export const deleteCampaignController = async (req, res, next) => {
  try {
    await deleteCampaign(req.tenantId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const startCampaignController = async (req, res, next) => {
  try {
    const campaign = await updateCampaignStatus(req.tenantId, req.params.id, 'processing');
    await enqueueCampaign(campaign.id, req.tenantId);
    res.json({ message: 'Campaign started', campaign });
  } catch (error) {
    next(error);
  }
};

export const pauseCampaignController = async (req, res, next) => {
  try {
    const campaign = await updateCampaignStatus(req.tenantId, req.params.id, 'paused');
    res.json({ message: 'Campaign paused', campaign });
  } catch (error) {
    next(error);
  }
};

export const resumeCampaignController = async (req, res, next) => {
  try {
    const campaign = await updateCampaignStatus(req.tenantId, req.params.id, 'processing');
    await enqueueCampaign(campaign.id, req.tenantId);
    res.json({ message: 'Campaign resumed', campaign });
  } catch (error) {
    next(error);
  }
};

export const cancelCampaignController = async (req, res, next) => {
  try {
    const campaign = await updateCampaignStatus(req.tenantId, req.params.id, 'cancelled');
    res.json({ message: 'Campaign cancelled', campaign });
  } catch (error) {
    next(error);
  }
};

export const getCampaignStatusController = async (req, res, next) => {
  try {
    const status = await getCampaignStatus(req.tenantId, req.params.id);
    res.json(status);
  } catch (error) {
    next(error);
  }
};

export const previewRecipientsController = async (req, res, next) => {
  try {
    const result = await previewRecipients(req.tenantId, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const runScheduledNowController = async (req, res, next) => {
  try {
    const campaign = await runScheduledNow(req.tenantId, req.params.campaignId);
    await enqueueCampaign(campaign.id, req.tenantId);
    res.json({ message: 'Campaign is now processing', campaign });
  } catch (error) {
    next(error);
  }
};

export const scheduleCampaignController = async (req, res, next) => {
  try {
    const campaign = await setCampaignSchedule(req.tenantId, req.params.campaignId, req.body.scheduledAt);
    res.json({ message: 'Campaign scheduled', campaign });
  } catch (error) {
    next(error);
  }
};

export const updateScheduleController = async (req, res, next) => {
  try {
    const campaign = await setCampaignSchedule(req.tenantId, req.params.campaignId, req.body.scheduledAt);
    res.json({ message: 'Schedule updated', campaign });
  } catch (error) {
    next(error);
  }
};

export const cancelScheduleController = async (req, res, next) => {
  try {
    const campaign = await cancelSchedule(req.tenantId, req.params.campaignId);
    res.json({ message: 'Schedule cancelled', campaign });
  } catch (error) {
    next(error);
  }
};

export const listScheduledCampaignsController = async (req, res, next) => {
  try {
    const campaigns = await getScheduledCampaigns(req.tenantId);
    res.json({ scheduled: campaigns });
  } catch (error) {
    next(error);
  }
};

export const getDashboardSummaryController = async (req, res, next) => {
  try {
    const summary = await getDashboardSummary(req.tenantId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
};

export const getPerformanceChartController = async (req, res, next) => {
  try {
    const { range = '7d' } = req.query;
    const days = range === '30d' ? 30 : range === '90d' ? 90 : 7;
    const chart = await getPerformanceChart(req.tenantId, days);
    res.json(chart);
  } catch (error) {
    next(error);
  }
};

export const getRecentActivityController = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    const activity = await getRecentActivity(req.tenantId, parseInt(limit));
    res.json(activity);
  } catch (error) {
    next(error);
  }
};