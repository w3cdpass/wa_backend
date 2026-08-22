import { config } from '../config/index.js';
import {
  login,
  signup,
  logout,
  refreshToken as refreshTokenService,
  me,
  requestOtp,
  verifyOtp,
} from '../services/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export const loginController = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await login(email, password, req.tenantId);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
};

export const signupController = async (req, res, next) => {
  try {
    const { name, businessName, email, password } = req.body;
    const result = await signup(name, email, password, businessName, req.tenantId);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
};

export const logoutController = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (refreshToken) {
      await logout(refreshToken);
    }
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
    });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};

export const refreshTokenController = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) throw new AppError('Refresh token required', 401);
    
    const result = await refreshTokenService(refreshToken);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({ accessToken: result.accessToken });
  } catch (error) {
    next(error);
  }
};

export const meController = async (req, res, next) => {
  try {
    const user = await me(req.user.id);
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

export const requestOtpController = async (req, res, next) => {
  try {
    const { virtualNumber } = req.body;
    const result = await requestOtp(virtualNumber);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const verifyOtpController = async (req, res, next) => {
  try {
    const { virtualNumber, otp } = req.body;
    const result = await verifyOtp(virtualNumber, otp, req.tenantId);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    res.json({
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
};