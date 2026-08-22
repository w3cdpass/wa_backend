import amqp from 'amqplib';
import { config } from '../config/index.js';

let connection = null;
let channel = null;
let isConnecting = false;
let connectionFailed = false;

export const connectQueue = async () => {
  if (isConnecting || connectionFailed) return channel;
  
  isConnecting = true;
  try {
    connection = await amqp.connect(config.rabbitmq.url);
    channel = await connection.createChannel();
    await channel.assertQueue(config.rabbitmq.queue, { durable: true });
    console.log('RabbitMQ connected');
    connectionFailed = false;
    return channel;
  } catch (error) {
    console.warn('RabbitMQ not available, queue features disabled:', error.message);
    connectionFailed = true;
    channel = null;
    return null;
  } finally {
    isConnecting = false;
  }
};

export const getChannel = () => channel;

export const enqueueMessage = async (message) => {
  if (!channel) {
    await connectQueue();
  }
  if (!channel) {
    console.warn('Queue unavailable, message dropped:', message.type);
    return false;
  }
  return channel.sendToQueue(
    config.rabbitmq.queue,
    Buffer.from(JSON.stringify(message)),
    { persistent: true }
  );
};

export const enqueueCampaign = async (campaignId, tenantId) => {
  return enqueueMessage({ type: 'CAMPAIGN_START', campaignId, tenantId, timestamp: new Date().toISOString() });
};

export const enqueueMessageJob = async (data) => {
  return enqueueMessage({ type: 'SEND_MESSAGE', ...data, timestamp: new Date().toISOString() });
};

export const closeQueue = async () => {
  if (channel) await channel.close();
  if (connection) await connection.close();
};