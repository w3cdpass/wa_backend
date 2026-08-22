import { Router } from 'express';
import {
  getWalletController,
  getCreditHistoryController,
  addCreditController,
  transferCreditController,
  getPricingController,
} from '../controllers/credits.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { addCreditSchema, transferCreditSchema, listCreditHistorySchema } from '../validators/credits.js';

const router = Router();
router.use(authenticate);

router.get('/wallet', getWalletController);
router.get('/history', validate(listCreditHistorySchema), getCreditHistoryController);
router.get('/pricing', getPricingController);
router.post('/add',  validate(addCreditSchema), addCreditController);
router.post('/transfer', requireRole('Reseller', 'Admin'), validate(transferCreditSchema), transferCreditController);

export default router;