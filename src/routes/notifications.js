import { Router } from 'express';
import {
  listNotificationsController,
  markAsReadController,
  markAllAsReadController,
} from '../controllers/notifications.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listNotificationsSchema, markReadSchema } from '../validators/notifications.js';

const router = Router();
router.use(authenticate);

router.get('/', validate(listNotificationsSchema), listNotificationsController);
router.post('/:id/read', validate(markReadSchema), markAsReadController);
router.post('/read-all', markAllAsReadController);

export default router;