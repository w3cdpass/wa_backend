import { Router } from 'express';
import {
  listWaHistoryController,
  getWaHistoryDetailController,
  exportWaHistoryController,
} from '../controllers/waHistory.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

const listSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    status: z.enum(['draft', 'scheduled', 'processing', 'sent', 'completed', 'paused', 'cancelled', 'failed']).optional(),
    search: z.string().optional(),
  }),
});

const idParam = z.object({
  params: z.object({ id: z.string().min(1) }),
});

router.get('/', validate(listSchema), listWaHistoryController);
router.get('/export', exportWaHistoryController);
router.get('/:id', validate(idParam), getWaHistoryDetailController);

export default router;