import mongoose from 'mongoose';

const broadcastVariableSchema = new mongoose.Schema({
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  body: [String],
  header: String,
  buttons: mongoose.Schema.Types.Mixed,
}, { _id: false });

const broadcastSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template', required: true },
  status: { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'paused', 'completed'], default: 'draft' },
  audience: {
    type: { type: String, enum: ['all', 'tags', 'list', 'segment'], default: 'list' },
    contactIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contact' }],
    tagIds: [String],
    filter: mongoose.Schema.Types.Mixed,
  },
  scheduleAt: Date,
  variables: [broadcastVariableSchema],
  // Position bindings chosen at compose time:
  // { body: [{ position, mode: 'variable'|'fixed', variableId, value }], header: { mode, variableId, value } }
  bindings: mongoose.Schema.Types.Mixed,
  stats: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  phoneNumberId: String,
  errorMessage: String,
  completedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

broadcastSchema.index({ tenantId: 1, status: 1 });
broadcastSchema.index({ tenantId: 1, createdAt: -1 });
broadcastSchema.index({ scheduleAt: 1, status: 1 });

export const Broadcast = mongoose.model('Broadcast', broadcastSchema);
export default Broadcast;