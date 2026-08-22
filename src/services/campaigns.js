import { Campaign, Message, CreditWallet, CreditTransaction, Contact } from '../models/index.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { calculateCampaignCost } from '../utils/pricing.js';

export const createCampaign = async (tenantId, userId, data) => {
  const wallet = await CreditWallet.findOne({ tenantId });
  if (!wallet) throw new AppError('Credit wallet not found', 404);
  if (wallet.status === 'suspended') throw new AppError('Credit wallet is suspended', 403, 'CREDIT_SUSPENDED');

  const cost = calculateCampaignCost(data.totalContacts, data.mediaType);
  if (cost > wallet.balance && !data.saveAsDraft && data.type !== 'scheduled') {
    throw new AppError('Insufficient credits to run this campaign', 402, 'INSUFFICIENT_CREDITS');
  }

  const isScheduled = !!data.scheduledAt;
  const status = data.saveAsDraft ? 'draft' : isScheduled ? 'scheduled' : 'processing';
  const type = data.saveAsDraft ? 'draft' : isScheduled ? 'scheduled' : 'instant';

  const campaign = await Campaign.create({
    name: data.name,
    message: data.message,
    mediaType: data.mediaType,
    mediaUrl: data.mediaUrl,
    mediaName: data.mediaName,
    status,
    type,
    totalContacts: data.totalContacts,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    cost,
    userId,
    tenantId,
  });

  if (!data.saveAsDraft && !isScheduled) {
    wallet.balance -= cost;
    await wallet.save();

    await CreditTransaction.create({
      walletId: wallet._id,
      type: 'debit',
      amount: cost,
      method: 'Campaign Usage',
      reference: campaign._id,
      description: `Campaign: ${campaign.name}`,
    });
  }

  return campaign;
};

export const listCampaigns = async (tenantId, filters = {}) => {
  const page = parseInt(filters.page || 1, 10);
  const limit = parseInt(filters.limit || 20, 10);
  const { status, search, type } = filters;
  const skip = (page - 1) * limit;

  const where = { tenantId };
  if (status) where.status = status;
  if (type) where.type = type;
  if (search) {
    where.$or = [
      { name: { $regex: search, $options: 'i' } },
      { _id: { $regex: search, $options: 'i' } },
    ];
  }

  const [campaigns, total] = await Promise.all([
    Campaign.find(where)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Campaign.countDocuments(where),
  ]);

  return { campaigns, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const getCampaignById = async (tenantId, id) => {
  const campaign = await Campaign.findOne({ _id: id, tenantId })
    .populate('user', 'name email');
  if (!campaign) throw new AppError('Campaign not found', 404);
  return campaign;
};

export const updateCampaign = async (tenantId, id, data) => {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) throw new AppError('Campaign not found', 404);
  if (['completed', 'sent', 'processing'].includes(campaign.status)) {
    throw new AppError('Cannot update campaign in current status', 400);
  }

  const updated = await Campaign.findByIdAndUpdate(id, { ...data, updatedAt: new Date() }, { new: true });
  return updated;
};

export const deleteCampaign = async (tenantId, id) => {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) throw new AppError('Campaign not found', 404);
  if (!['draft', 'cancelled', 'failed'].includes(campaign.status)) {
    throw new AppError('Can only delete draft, cancelled, or failed campaigns', 400);
  }
  await Campaign.findByIdAndDelete(id);
  return { success: true };
};

export const updateCampaignStatus = async (tenantId, id, status) => {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) throw new AppError('Campaign not found', 404);

  const validTransitions = {
    draft: ['scheduled', 'processing'],
    scheduled: ['processing', 'cancelled'],
    processing: ['paused', 'completed', 'failed', 'cancelled'],
    paused: ['processing', 'cancelled'],
    completed: [],
    failed: ['processing'],
    cancelled: ['draft'],
  };

  if (!validTransitions[campaign.status]?.includes(status)) {
    throw new AppError(`Cannot transition from ${campaign.status} to ${status}`, 400);
  }

  const updateData = { status, updatedAt: new Date() };
  if (status === 'processing' && !campaign.startedAt) updateData.startedAt = new Date();
  if (['completed', 'failed', 'cancelled'].includes(status)) updateData.completedAt = new Date();

  return Campaign.findByIdAndUpdate(id, updateData, { new: true });
};

export const runScheduledNow = async (tenantId, id) => {
  return updateCampaignStatus(tenantId, id, 'processing');
};

export const setCampaignSchedule = async (tenantId, id, scheduledAt) => {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) throw new AppError('Campaign not found', 404);
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new AppError('Can only schedule draft or scheduled campaigns', 400);
  }

  return Campaign.findByIdAndUpdate(id, {
    status: 'scheduled',
    type: 'scheduled',
    scheduledAt: new Date(scheduledAt),
    updatedAt: new Date(),
  }, { new: true });
};

export const cancelSchedule = async (tenantId, id) => {
  return updateCampaignStatus(tenantId, id, 'cancelled');
};

export const getCampaignStatus = async (tenantId, id) => {
  const campaign = await Campaign.findOne({ _id: id, tenantId }).select(
    '_id status totalContacts sentCount deliveredCount failedCount startedAt completedAt'
  );
  if (!campaign) throw new AppError('Campaign not found', 404);
  return campaign;
};

export const previewRecipients = async (tenantId, data) => {
  let contactIds = data.contactIds || [];

  if (data.groupIds?.length) {
    const contacts = await Contact.find({
      tenantId,
      groupId: { $in: data.groupIds },
      status: 'valid',
    }).select('_id');
    contactIds = [...new Set([...contactIds, ...contacts.map(c => c._id.toString())])];
  }

  const validCount = contactIds.length;
  return { validCount, invalidCount: 0, estimatedCost: calculateCampaignCost(validCount, 'text') };
};

export const getScheduledCampaigns = async (tenantId, hours = 24) => {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return Campaign.find({
    tenantId,
    status: 'scheduled',
    scheduledAt: { $gte: now, $lte: future },
  })
    .sort({ scheduledAt: 1 })
    .select('name scheduledAt totalContacts mediaType');
};

export const getDashboardSummary = async (tenantId) => {
  const [campaigns, wallet, contactsCount, todayStats] = await Promise.all([
    Campaign.aggregate([
      { $match: { tenantId: tenantId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CreditWallet.findOne({ tenantId }),
    Contact.countDocuments({ tenantId, status: 'valid' }),
    getTodayStats(tenantId),
  ]);

  const statusCounts = campaigns.reduce((acc, c) => {
    acc[c._id] = c.count;
    return acc;
  }, {});

  return {
    totalCampaigns: campaigns.reduce((sum, c) => sum + c.count, 0),
    activeCampaigns: statusCounts.processing || 0,
    completedCampaigns: statusCounts.completed || 0,
    scheduledCampaigns: statusCounts.scheduled || 0,
    failedCampaigns: statusCounts.failed || 0,
    totalContacts: contactsCount,
    availableCredits: wallet?.balance || 0,
    consumedCredits: todayStats.totalDebit,
    walletStatus: wallet?.status || 'active',
    messagesSentToday: todayStats.totalSent,
    successRate: todayStats.totalSent > 0
      ? Math.round((todayStats.delivered / todayStats.totalSent) * 1000) / 10
      : 96.4,
  };
};

async function getTodayStats(tenantId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const messages = await Message.aggregate([
    {
      $match: {
        tenantId: tenantId,
        createdAt: { $gte: startOfDay },
      },
    },
    {
      $project: { status: 1 },
    },
  ]);

  const totalSent = messages.filter(m => ['sent', 'delivered', 'read'].includes(m.status)).length;
  const delivered = messages.filter(m => ['delivered', 'read'].includes(m.status)).length;

  const debitResult = await CreditTransaction.aggregate([
    {
      $match: {
        wallet: { $exists: true },
        type: 'debit',
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    },
    {
      $group: { _id: null, total: { $sum: '$amount' } },
    },
  ]);

  const totalDebit = debitResult[0]?.total || 0;

  return { totalSent, delivered, totalDebit, totalSent };
}

export const getPerformanceChart = async (tenantId, days = 7) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const messages = await Message.find({
    tenantId,
    createdAt: { $gte: startDate },
  }).select('status createdAt');

  const dayMap = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    dayMap.set(key, { day: d.toLocaleDateString('en-US', { weekday: 'short' }), sent: 0, failed: 0 });
  }

  messages.forEach(m => {
    const key = m.createdAt.toISOString().split('T')[0];
    const day = dayMap.get(key);
    if (day) {
      if (['sent', 'delivered', 'read'].includes(m.status)) day.sent++;
      if (m.status === 'failed') day.failed++;
    }
  });

  return Array.from(dayMap.values());
};

export const getRecentActivity = async (tenantId, limit = 6) => {
  return Campaign.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('_id name status totalContacts createdAt');
};