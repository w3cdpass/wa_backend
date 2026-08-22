import { Router } from 'express';
import {
  presignUploadController,
  confirmUploadController,
  deleteMediaController,
  listMediaController,
} from '../controllers/media.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { presignUploadSchema, deleteMediaSchema } from '../validators/media.js';

const router = Router();
router.use(authenticate);

router.post('/presign', validate(presignUploadSchema), presignUploadController);
router.post('/confirm', confirmUploadController);
router.delete('/:id', validate(deleteMediaSchema), deleteMediaController);
router.get('/', listMediaController);

export default router;