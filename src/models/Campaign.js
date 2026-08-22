import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  message: { type: String, required: true },
  mediaUrl: { type: String },
  mediaType: { type: String, enum: ['text', 'image', 'video', 'document', 'pdf'], default: 'text' },
  mediaName: { type: String },
  status: { type: String, enum: ['draft', 'scheduled', 'processing', 'sent', 'failed', 'paused', 'completed', 'cancelled'], default: 'draft' },
  type: { type: String, enum: ['instant', 'scheduled', 'draft'], default: 'instant' },
  scheduledAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  totalContacts: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  deliveredCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  failureReasons: { type: String }, // JSON string
  cost: { type: Number, default: 0 },

  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

}, { timestamps: true });

campaignSchema.index({ userId: 1 });
campaignSchema.index({ tenantId: 1 });
campaignSchema.index({ status: 1 });
campaignSchema.index({ scheduledAt: 1 });
campaignSchema.index({ type: 1 });

export const Campaign = mongoose.model('Campaign', campaignSchema);
export default Campaign;