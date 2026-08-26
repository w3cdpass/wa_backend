import mongoose from 'mongoose';

const webhookEventSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  type: { type: String, enum: ['message', 'messages', 'status', 'template', 'quality', 'phone_number', 'account_update', 'webhook_verified'], required: true },
  metaEventId: String,
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  processed: { type: Boolean, default: false },
  error: String,
  processingTimeMs: Number,
}, { timestamps: true });

webhookEventSchema.index({ tenantId: 1, type: 1, createdAt: -1 });
webhookEventSchema.index({ metaEventId: 1 });
webhookEventSchema.index({ processed: 1, createdAt: 1 });

export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
export default WebhookEvent;