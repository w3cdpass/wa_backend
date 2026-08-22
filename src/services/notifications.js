import { Notification } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const listNotifications = async (userId, tenantId, filters = {}) => {
  const page = parseInt(filters.page || 1, 10);
  const limit = parseInt(filters.limit || 20, 10);
  const { unreadOnly } = filters;
  const skip = (page - 1) * limit;

  const where = { userId, tenantId };
  if (unreadOnly) where.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(where)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Notification.countDocuments(where),
    Notification.countDocuments({ userId, tenantId, isRead: false }),
  ]);

  return { notifications, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }, unreadCount };
};

export const markAsRead = async (userId, tenantId, id) => {
  const notification = await Notification.findOne({ _id: id, userId, tenantId });
  if (!notification) throw new AppError('Notification not found', 404);

  notification.isRead = true;
  await notification.save();
  return { success: true };
};

export const markAllAsRead = async (userId, tenantId) => {
  await Notification.updateMany(
    { userId, tenantId, isRead: false },
    { isRead: true }
  );
  return { success: true };
};

export const createNotification = async (tenantId, userId, data) => {
  return Notification.create({
    userId,
    tenantId,
    title: data.title,
    message: data.message,
    type: data.type || 'info',
    data: data.data ? JSON.stringify(data.data) : null,
  });
};