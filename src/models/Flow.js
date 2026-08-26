import mongoose from 'mongoose';

const flowNodeConfigSchema = new mongoose.Schema({
  nodeKey: { type: String, required: true },
  nodeType: { type: String, required: true },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
}, { _id: false });

const flowEdgeSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  label: String,
  sourceHandle: String,
  targetHandle: String,
  outputIndex: { type: Number, default: null },
}, { _id: false });

const fallbackPolicySchema = new mongoose.Schema({
  onUnknownReply: { type: String, enum: ['reprompt', 'handoff', 'ignore'], default: 'reprompt' },
  maxReprompts: { type: Number, default: 2 },
  onTimeoutHours: { type: Number, default: 24 },
  onExhaust: { type: String, enum: ['handoff', 'end'], default: 'handoff' },
}, { _id: false });

const triggerSchema = new mongoose.Schema({
  type: { type: String, enum: ['keyword', 'first_inbound_message', 'manual', 'interactive_reply'], required: true },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const flowSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  name: { type: String, required: true },
  description: String,
  status: { type: String, enum: ['draft', 'active', 'paused', 'archived'], default: 'draft' },
  trigger: triggerSchema,
  nodes: [flowNodeConfigSchema],
  edges: [flowEdgeSchema],
  fallbackPolicy: { type: fallbackPolicySchema, default: () => ({}) },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  version: { type: Number, default: 1 },
  publishedAt: Date,
}, { timestamps: true });

flowSchema.index({ tenantId: 1, status: 1 });
flowSchema.index({ tenantId: 1, name: 1 });
flowSchema.index({ tenantId: 1, createdAt: -1 });

export const Flow = mongoose.model('Flow', flowSchema);
export default Flow;