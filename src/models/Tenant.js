import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  plan: { type: String, default: 'free', enum: ['free', 'starter', 'pro', 'enterprise'] },
  isActive: { type: Boolean, default: true },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  meta: {
    appId: String,
    appSecret: String,
    wabaId: String,
    accessTokenEnc: String,
    businessAccountId: String,
  },
}, { timestamps: true });

tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.index({ isActive: 1 });

export const Tenant = mongoose.model('Tenant', tenantSchema);
export default Tenant;