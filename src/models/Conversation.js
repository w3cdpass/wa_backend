import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  phoneNumberId: { type: String, required: true },
  status: { type: String, enum: ['open', 'closed', 'pending', 'snoozed'], default: 'open' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastMessageText: String,
  lastMessageAt: Date,
  unreadCount: { type: Number, default: 0 },
  snoozedUntil: Date,
  tags: [String],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

conversationSchema.index({ tenantId: 1, contactId: 1 }, { unique: true });
conversationSchema.index({ tenantId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, assignedTo: 1, status: 1 });
conversationSchema.index({ phoneNumberId: 1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
export default Conversation;