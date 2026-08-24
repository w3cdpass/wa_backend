import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || '3001'}`,
  webhookPath: '/api/webhooks/whatsapp',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-in-production-min-32-chars-long',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production-min-32-chars-long',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/wa_campaign',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
    queue: process.env.RABBITMQ_QUEUE || 'campaign_messages',
  },

  whatsapp: {
    provider: 'meta',
    meta: {
      accessToken: process.env.META_ACCESS_TOKEN,
      phoneNumberId: process.env.META_PHONE_NUMBER_ID,
      businessAccountId: process.env.META_BUSINESS_ACCOUNT_ID,
      wabaId: process.env.META_WABA_ID,
      appSecret: process.env.META_APP_SECRET,
      apiVersion: process.env.META_API_VERSION || 'v21.0',
    },
  },

  storage: {
    provider: process.env.STORAGE_PROVIDER || 's3',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      bucket: process.env.S3_BUCKET,
      publicUrl: process.env.S3_PUBLIC_URL,
    },
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || 'dev-32-byte-encryption-key-change-me',
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 1000,
    authMaxRequests: 100,
  },

  processingWindow: {
    startHour: 9,
    endHour: 21,
    timezone: 'Asia/Kolkata',
  },

  mediaLimits: {
    image: 5 * 1024 * 1024,
    video: 30 * 1024 * 1024,
    pdf: 5 * 1024 * 1024,
  },

  pricing: {
    text: 0.5,
    image: 1.0,
    video: 2.0,
    pdf: 1.5,
  },

  demo: {
    virtualNumber: '+91 92345 00110',
    otp: '123456',
  },
};

export const initializeDB = async () => {
  const { connectDB } = await import('./mongodb.js');
  await connectDB();
};

export default config;