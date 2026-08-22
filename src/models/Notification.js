import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'info' },
  isRead: { type: Boolean, default: false },
  data: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;