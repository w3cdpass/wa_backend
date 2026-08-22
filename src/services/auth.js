import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, RefreshToken, Tenant, CreditWallet } from '../models/index.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

const SALT_ROUNDS = 12;

export const hashPassword = async (password) => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

export const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user._id, email: user.email, role: user.role, tenantId: user.tenantId },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiry }
  );

  const refreshToken = jwt.sign(
    { userId: user._id, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiry }
  );

  return { accessToken, refreshToken };
};

export const storeRefreshToken = async (userId, refreshToken) => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await RefreshToken.create({ token: refreshToken, userId, expiresAt });
};

export const revokeRefreshToken = async (refreshToken) => {
  await RefreshToken.findOneAndUpdate(
    { token: refreshToken },
    { revokedAt: new Date() }
  );
};

export const revokeAllUserTokens = async (userId) => {
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { revokedAt: new Date() }
  );
};

export const validateRefreshToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401);
    }

    const storedToken = await RefreshToken.findOne({ token: refreshToken }).populate('userId');

    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
      throw new AppError('Refresh token expired or revoked', 401);
    }

    if (!storedToken.userId?.isActive) {
      throw new AppError('User is inactive', 401);
    }

    return storedToken.userId;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Invalid refresh token', 401);
  }
};

export const createUser = async (name, email, password, businessName, tenantId) => {
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('Email already registered', 409);
  }

  const passwordHash = await hashPassword(password);

  const user = await User.create({
    name,
    email,
    passwordHash,
    businessName: businessName || 'My Business',
    tenantId,
  });

  return user;
};

export const findUserByEmail = async (email) => {
  return User.findOne({ email });
};

export const updateLastLogin = async (userId) => {
  await User.findByIdAndUpdate(userId, { lastLoginAt: new Date() });
};

export const getUserWithTokens = async (userId) => {
  return User.findById(userId).select(
    '_id email name businessName role tenantId virtualNumber isActive createdAt'
  );
};

export const getTenantOrCreateDemo = async (slug = 'demo') => {
  let tenant = await Tenant.findOne({ slug });
  if (!tenant) {
    tenant = await Tenant.create({ name: 'Demo Tenant', slug });
    await CreditWallet.create({ tenantId: tenant._id, balance: 10000 });
  }
  return tenant;
};

export const login = async (email, password) => {
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user) throw new AppError('Invalid email or password', 401);

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) throw new AppError('Invalid email or password', 401);

  if (!user.isActive) throw new AppError('Account is deactivated', 403);

  await updateLastLogin(user._id);
  const { accessToken, refreshToken } = generateTokens(user);
  await storeRefreshToken(user._id, refreshToken);

  const userData = await getUserWithTokens(user._id);
  return { user: userData, accessToken, refreshToken };
};

export const signup = async (name, email, password, businessName, tenantId) => {
  const tenant = await getTenantOrCreateDemo();
  const user = await createUser(name, email, password, businessName, tenant._id);
  const { accessToken, refreshToken } = generateTokens(user);
  await storeRefreshToken(user._id, refreshToken);

  const userData = await getUserWithTokens(user._id);
  return { user: userData, accessToken, refreshToken };
};

export const logout = async (refreshToken) => {
  if (refreshToken) await revokeRefreshToken(refreshToken);
};

export const refreshToken = async (refreshToken) => {
  const user = await validateRefreshToken(refreshToken);
  await revokeRefreshToken(refreshToken);
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
  await storeRefreshToken(user._id, newRefreshToken);
  return { accessToken, refreshToken: newRefreshToken };
};

export const me = async (userId) => {
  return getUserWithTokens(userId);
};

export const requestOtp = async (virtualNumber) => {
  const cleanInput = virtualNumber.replace(/\s/g, '');
  const cleanDemo = config.demo.virtualNumber.replace(/\s/g, '');
  if (cleanInput !== cleanDemo) {
    throw new AppError('Virtual number not recognized', 400);
  }
  return { sent: true, expiresIn: 300 };
};

export const verifyOtp = async (virtualNumber, otp, tenantId) => {
  const cleanInput = virtualNumber.replace(/\s/g, '');
  const cleanDemo = config.demo.virtualNumber.replace(/\s/g, '');
  if (cleanInput !== cleanDemo) throw new AppError('Virtual number not recognized', 400);
  if (otp !== config.demo.otp) throw new AppError('Incorrect OTP', 400);

  const tenant = await getTenantOrCreateDemo();
  let user = await User.findOne({ virtualNumber: config.demo.virtualNumber, tenantId: tenant._id });
  
  if (!user) {
    user = await User.create({
      name: 'Infyle Demo Reseller',
      email: 'demo@infyle.com',
      passwordHash: await hashPassword('demo123456'),
      role: 'Reseller',
      virtualNumber: config.demo.virtualNumber,
      businessName: 'Infyle Technologies',
      tenantId: tenant._id,
    });
  }

  const { accessToken, refreshToken } = generateTokens(user);
  await storeRefreshToken(user._id, refreshToken);
  await updateLastLogin(user._id);

  const userData = await getUserWithTokens(user._id);
  return { user: userData, accessToken, refreshToken };
};