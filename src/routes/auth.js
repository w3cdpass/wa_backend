import { Router } from 'express';
import {
  loginController,
  signupController,
  logoutController,
  refreshTokenController,
  meController,
  requestOtpController,
  verifyOtpController,
} from '../controllers/auth.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, signupSchema, refreshTokenSchema, requestOtpSchema, verifyOtpSchema } from '../validators/auth.js';

const router = Router();

router.post('/login', validate(loginSchema), loginController);
router.post('/signup', validate(signupSchema), signupController);
router.post('/logout', logoutController);
router.post('/refresh-token', validate(refreshTokenSchema), refreshTokenController);
router.get('/me', authenticate, meController);
router.post('/request-otp', validate(requestOtpSchema), requestOtpController);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtpController);

export default router;