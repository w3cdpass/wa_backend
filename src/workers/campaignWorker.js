import amqp from 'amqplib';
import { Campaign, Message } from '../models/index.js';
import { config } from '../config/index.js';
import { whatsappService } from '../services/whatsapp.js';
import { enqueueMessageJob } from '../services/queue.js';

const QUEUE_NAME = config.rabbitmq.queue;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;

async function processCampaignMessage(msg) {
  if (!msg) return;
  try {
    const content = JSON.parse(msg.content.toString());
    if (content.type === 'CAMPAIGN_START') {
      await processCampaign(content.campaignId, content.tenantId);
    } else if (content.type === 'SEND_MESSAGE') {
      await sendSingleMessage(content);
    }
  } catch (error) {
    console.error('Worker error:', error);
  }
}

async function processCampaign(campaignId, tenantId) {
  const campaign = await Campaign.findOne({ _id: campaignId, tenantId });
  
  if (!campaign) {
    console.error('Campaign not found:', campaignId);
    return;
  }

  if (campaign.status !== 'processing') {
    console.log('Campaign not in processing state:', campaign.status);
    return;
  }

  if (!whatsappService.isInProcessingWindow()) {
    const nextWindow = whatsappService.getNextWindowStart();
    const delay = nextWindow.getTime() - Date.now();
    console.log(`Outside processing window. Rescheduling in ${Math.round(delay / 1000 / 60)} minutes`);
    setTimeout(() => enqueueMessageJob({ type: 'CAMPAIGN_START', campaignId, tenantId }), delay);
    return;
  }

  const pendingMessages = await Message.find({ campaignId, tenantId, status: 'pending' });
  console.log(`Processing ${pendingMessages.length} messages for campaign ${campaignId}`);

  for (let i = 0; i < pendingMessages.length; i += BATCH_SIZE) {
    if (!whatsappService.isInProcessingWindow()) {
      const nextWindow = whatsappService.getNextWindowStart();
      const delay = nextWindow.getTime() - Date.now();
      console.log(`Processing window closed. Rescheduling remaining messages.`);
      setTimeout(() => enqueueMessageJob({ type: 'CAMPAIGN_START', campaignId, tenantId }), delay);
      return;
    }

    const batch = pendingMessages.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(msg => enqueueMessageJob({
      type: 'SEND_MESSAGE',
      campaignId,
      tenantId,
      messageId: msg._id,
      phoneNumber: msg.phoneNumber,
      mediaType: campaign.mediaType,
      mediaUrl: campaign.mediaUrl,
      message: campaign.message,
      mediaName: campaign.mediaName,
    })));

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  const remaining = await Message.countDocuments({ campaignId, tenantId, status: 'pending' });
  if (remaining > 0) {
    setImmediate(() => processCampaign(campaignId, tenantId));
  }
}

async function sendSingleMessage(data) {
  const { messageId, campaignId, tenantId, phoneNumber, mediaType, mediaUrl, message, mediaName } = data;

  const messageRecord = await Message.findById(messageId);
  if (!messageRecord || messageRecord.status !== 'pending') return;

  messageRecord.status = 'sending';
  await messageRecord.save();

  let result;
  switch (mediaType) {
    case 'image':
      result = await whatsappService.sendImageMessage(phoneNumber, mediaUrl, message);
      break;
    case 'video':
      result = await whatsappService.sendVideoMessage(phoneNumber, mediaUrl, message);
      break;
    case 'pdf':
      result = await whatsappService.sendDocumentMessage(phoneNumber, mediaUrl, mediaName, message);
      break;
    default:
      result = await whatsappService.sendTextMessage(phoneNumber, message);
  }

  if (result.success) {
    messageRecord.status = 'sent';
    messageRecord.waMessageId = result.messageId;
    messageRecord.sentAt = new Date();
    await messageRecord.save();
    await updateCampaignCounts(campaignId, 'sent');
  } else {
    const errorCode = result.errorCode || 'UNKNOWN_ERROR';
    let status = 'failed';
    if (errorCode === '131026' || errorCode === '131047') status = 'failed';

    messageRecord.status = status;
    messageRecord.errorCode = errorCode;
    messageRecord.errorMessage = result.error;
    messageRecord.sentAt = new Date();
    await messageRecord.save();
    await updateCampaignCounts(campaignId, 'failed', errorCode);
  }
}

async function updateCampaignCounts(campaignId, type, errorCode) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;

  const updates = {};
  if (type === 'sent') updates.sentCount = campaign.sentCount + 1;
  if (type === 'failed') {
    updates.failedCount = campaign.failedCount + 1;
    const reasons = campaign.failureReasons ? JSON.parse(campaign.failureReasons) : {};
    reasons[errorCode] = (reasons[errorCode] || 0) + 1;
    updates.failureReasons = JSON.stringify(reasons);
  }
  if (type === 'delivered') updates.deliveredCount = campaign.deliveredCount + 1;

  await Campaign.findByIdAndUpdate(campaignId, updates);

  const updated = await Campaign.findById(campaignId);
  if (updated && updated.sentCount + updated.failedCount >= updated.totalContacts) {
    await Campaign.findByIdAndUpdate(campaignId, { status: 'completed', completedAt: new Date() });
  }
}

async function startWorker() {
  console.log('Starting campaign worker...');
  const connection = await amqp.connect(config.rabbitmq.url);
  const channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  channel.prefetch(10);

  channel.consume(QUEUE_NAME, async (msg) => {
    await processCampaignMessage(msg);
    channel.ack(msg);
  });

  console.log('Campaign worker running');
}

startWorker().catch(console.error);