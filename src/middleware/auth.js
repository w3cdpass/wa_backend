import { config } from '../config/index.js';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No access token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.accessSecret);

    const user = await User.findById(decoded.userId).select(
      '_id email name businessName role tenantId isActive virtualNumber'
    );

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User not found or inactive' });
    }

    const tenantId = req.headers['x-tenant-id'] || decoded.tenantId;
    if (tenantId && tenantId !== user.tenantId.toString()) {
      return res.status(403).json({ message: 'Tenant mismatch' });
    }

    req.user = user;
    req.tenantId = user.tenantId.toString();
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Access token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid access token' });
    }
    return res.status(401).json({ message: 'Authentication failed' });
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.accessSecret);

    const user = await User.findById(decoded.userId).select(
      '_id email name role tenantId isActive'
    );

    if (user && user.isActive) {
      req.user = user;
      req.tenantId = user.tenantId.toString();
    }
    next();
  } catch {
    next();
  }
};

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
};