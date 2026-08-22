import { Campaign, Message } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const listWaHistoryController = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const tenantId = req.tenantId;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const where = { tenantId };
    if (status) where.status = status;

    const [campaigns, total] = await Promise.all([
      Campaign.find(where)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Campaign.countDocuments(where),
    ]);

    res.json({
      campaigns,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getWaHistoryDetailController = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const campaign = await Campaign.findOne({ _id: id, tenantId })
      .populate('user', 'name email');

    if (!campaign) {
      throw new AppError('Campaign not found', 404);
    }

    res.json(campaign);
  } catch (error) {
    next(error);
  }
};

export const getCampaignMessages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50, status } = req.query;
    const tenantId = req.tenantId;

    const campaign = await Campaign.findOne({ _id: id, tenantId: req.tenantId });
    if (!campaign) {
      throw new AppError('Campaign not found', 404);
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (parseInt(page, 10) - 1) * limitNum;

    const where = { campaignId: id, tenantId };
    if (status) where.status = status;

    const [messages, total] = await Promise.all([
      Message.find(where)
        .populate('contactId', 'name phoneNumber')
        .sort({ createdAt: -1 })
        .skip((parseInt(page, 10) - 1) * parseInt(limit, 10))
        .limit(parseInt(limit, 10)),
      Message.countDocuments(where),
    ]);

    res.json({
      messages,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const retryFailedMessages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!campaign) {
      throw new AppError('Campaign not found', 404);
    }

    if (!['failed', 'completed', 'cancelled'].includes(campaign.status)) {
      throw new AppError('Can only retry failed, completed, or cancelled campaigns', 400);
    }

    await Message.updateMany(
      { campaignId: req.params.id, tenantId: req.tenantId, status: 'failed' },
      { status: 'pending', errorCode: null, errorMessage: null }
    );

    await Campaign.findByIdAndUpdate(req.params.id, {
      status: 'processing',
      updatedAt: new Date(),
    });

    res.json({ success: true, message: 'Failed messages queued for retry' });
  } catch (error) {
    next(error);
  }
};

export const exportWaHistoryController = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const tenantId = req.tenantId;

    const where = { tenantId };
    if (status) where.status = status;

    const campaigns = await Campaign.find(where)
      .populate('user', 'name email')
      .sort({ createdAt: -1 });

    // Generate CSV
    const headers = ['ID', 'Name', 'Status', 'Type', 'Total Contacts', 'Sent', 'Delivered', 'Failed', 'Cost', 'Created At'];
    const rows = campaigns.map(c => [
      c._id,
      c.name,
      c.status,
      c.type,
      c.totalContacts,
      c.sentCount,
      c.deliveredCount,
      c.failedCount,
      c.cost,
      c.createdAt.toISOString(),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="wa-history-export.csv"');
    res.send(csv);
  } catch (error) {
    next(error);
  }
};