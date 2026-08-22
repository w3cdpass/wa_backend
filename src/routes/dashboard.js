import { Router } from 'express';
import {
  getDashboardSummaryController,
  getPerformanceChartController,
  getRecentActivityController,
} from '../controllers/campaigns.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/summary', getDashboardSummaryController);
router.get('/performance', getPerformanceChartController);
router.get('/activity', getRecentActivityController);

export default router;