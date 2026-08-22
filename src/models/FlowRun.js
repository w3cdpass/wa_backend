import mongoose from 'mongoose';

const flowRunSchema = new mongoose.Schema({
  flowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flow', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  currentNodeKey: { type: String, required: true },
  status: { type: String, enum: ['running', 'completed', 'handed_off', 'failed', 'paused'], default: 'running' },
  variables: { type: mongoose.Schema.Types.Mixed, default: {} },
  repromptCount: { type: Number, default: 0 },
  lastPromptMessageId: String,
  lastPromptNodeKey: String,
  lastActivityAt: { type: Date, default: Date.now },
  completedAt: Date,
  handoffTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  error: String,
}, { timestamps: true });

flowRunSchema.index({ tenantId: 1, contactId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['running', 'paused'] } } });
flowRunSchema.index({ flowId: 1, status: 1 });
flowRunSchema.index({ tenantId: 1, status: 1, lastActivityAt: -1 });
flowRunSchema.index({ conversationId: 1 });

export const FlowRun = mongoose.model('FlowRun', flowRunSchema);
export default FlowRun;