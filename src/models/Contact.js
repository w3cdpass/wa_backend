import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  phone: { type: String, required: true },
  name: { type: String, trim: true },
  avatarUrl: String,
  tags: [{ type: String, trim: true }],
  customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  optInStatus: { type: String, enum: ['opted_in', 'opted_out', 'unknown'], default: 'unknown' },
  lastMessageAt: Date,
  isBlocked: { type: Boolean, default: false },
  source: { type: String, default: 'manual' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

contactSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
contactSchema.index({ tenantId: 1, tags: 1 });
contactSchema.index({ tenantId: 1, optInStatus: 1 });
contactSchema.index({ tenantId: 1, lastMessageAt: -1 });

export const Contact = mongoose.model('Contact', contactSchema);
export default Contact;