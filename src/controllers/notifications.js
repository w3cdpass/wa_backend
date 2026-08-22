import { listNotifications, markAsRead, markAllAsRead } from '../services/notifications.js';
import { AppError } from '../middleware/errorHandler.js';

export const listNotificationsController = async (req, res, next) => {
  try {
    const { page, limit, unreadOnly } = req.query;
    const result = await listNotifications(req.user.id, req.tenantId, { page, limit, unreadOnly });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const markAsReadController = async (req, res, next) => {
  try {
    await markAsRead(req.user.id, req.tenantId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const markAllAsReadController = async (req, res, next) => {
  try {
    await markAllAsRead(req.user.id, req.tenantId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};