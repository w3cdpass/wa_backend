import { Router } from 'express';
import {
  createBroadcastController,
  previewCountController,
  listBroadcastsController,
  getBroadcastController,
  pauseBroadcastController,
  resumeBroadcastController,
} from '../controllers/broadcasts.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createBroadcastSchema,
  broadcastIdParam,
  previewCountSchema,
} from '../validators/broadcasts.js';

const router = Router();

router.use(authenticate);

router.get('/', listBroadcastsController);
router.post('/preview-count', validate(previewCountSchema), previewCountController);
router.post('/', validate(createBroadcastSchema), createBroadcastController);
router.get('/:id', validate(broadcastIdParam), getBroadcastController);
router.post('/:id/pause', validate(broadcastIdParam), pauseBroadcastController);
router.post('/:id/resume', validate(broadcastIdParam), resumeBroadcastController);

export default router;
