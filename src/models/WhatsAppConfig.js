import mongoose from 'mongoose';

const whatsAppConfigSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
  phoneNumberId: { type: String, required: true },
  displayPhoneNumber: { type: String },
  verifiedName: { type: String },
  qualityRating: { type: String, enum: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'], default: 'UNKNOWN' },
  accessTokenEnc: { type: String, required: true },
  appSecretEnc: { type: String },
  verifyToken: { type: String },
  wabaId: { type: String, required: true },
  isRegistered: { type: Boolean, default: false },
  pinEnc: { type: String },
  status: { type: String, enum: ['connected', 'disconnected', 'error', 'pending'], default: 'pending' },
  lastSyncAt: Date,
  lastQualityCheckAt: Date,
  webhookUrl: String,
}, { timestamps: true });

whatsAppConfigSchema.index({ tenantId: 1 }, { unique: true });
whatsAppConfigSchema.index({ phoneNumberId: 1 });
whatsAppConfigSchema.index({ wabaId: 1 });

export const WhatsAppConfig = mongoose.model('WhatsAppConfig', whatsAppConfigSchema);
export default WhatsAppConfig;