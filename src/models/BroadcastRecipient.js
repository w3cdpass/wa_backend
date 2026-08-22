import mongoose from 'mongoose';

const broadcastRecipientSchema = new mongoose.Schema({
  broadcastId: { type: mongoose.Schema.Types.ObjectId, ref: 'Broadcast', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  phone: { type: String, required: true },
  status: { type: String, enum: ['pending', 'queued', 'sent', 'delivered', 'read', 'failed', 'skipped'], default: 'pending' },
  metaMessageId: String,
  errorCode: String,
  errorMessage: String,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  retryCount: { type: Number, default: 0 },
  variables: {
    body: [String],
    header: String,
    buttons: mongoose.Schema.Types.Mixed,
  },
}, { timestamps: true });

broadcastRecipientSchema.index({ broadcastId: 1, status: 1 });
broadcastRecipientSchema.index({ broadcastId: 1, contactId: 1 }, { unique: true });
broadcastRecipientSchema.index({ contactId: 1, createdAt: -1 });
broadcastRecipientSchema.index({ metaMessageId: 1 });

export const BroadcastRecipient = mongoose.model('BroadcastRecipient', broadcastRecipientSchema);
export default BroadcastRecipient;