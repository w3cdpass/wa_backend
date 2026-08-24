import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { config, initializeDB } from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { connectQueue } from './services/queue.js';

import authRoutes from './routes/auth.js';
import campaignRoutes from './routes/campaigns.js';
import dashboardRoutes from './routes/dashboard.js';
import waHistoryRoutes from './routes/waHistory.js';
import scheduledRoutes from './routes/scheduled.js';
import contactsRoutes from './routes/contacts.js';
import creditsRoutes from './routes/credits.js';
import mediaRoutes from './routes/media.js';
import notificationsRoutes from './routes/notifications.js';
import whatsappRoutes from './routes/whatsapp.js';
import webhookRoutes from './routes/webhooks.js';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));

app.use(morgan(config.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMaxRequests,
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/wa-history', waHistoryRoutes);
app.use('/api/campaigns/scheduled', scheduledRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Public Meta webhook receiver (no auth — verified via hub.verify_token / x-hub-signature-256)
app.use('/api/webhooks/whatsapp', webhookRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async () => {
  try {
    await initializeDB();
    
    const server = app.listen(config.port, async () => {
      console.log(`🚀 Server running on port ${config.port} (${config.nodeEnv})`);
      console.log(`📡 API Base URL: http://localhost:${config.port}/api`);
      console.log(`🌐 CORS Origin: ${config.corsOrigin}`);
      
      try {
        await connectQueue();
      } catch (e) {
        console.warn('RabbitMQ not available, worker features disabled');
      }
    });

    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;