import mongoose from 'mongoose';

const templateButtonSchema = new mongoose.Schema({
  type: { type: String, enum: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'OTP', 'FLOW', 'CATALOG'], required: true },
  text: { type: String, required: true },
  url: String,
  phoneNumber: String,
  example: String,
  flowId: String,
  flowAction: String,
  catalogId: String,
  productRetailerId: String,
}, { _id: false });

const templateCardSchema = new mongoose.Schema({
  headerMediaUrl: String,
  headerHandle: String,
  bodyText: { type: String, default: '' },
  buttons: [templateButtonSchema],
}, { _id: false });

const templateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  metaTemplateId: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, lowercase: true, trim: true },
  category: { type: String, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'], required: true },
  language: { type: String, required: true, default: 'en_US' },
  status: { type: String, enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION'], default: 'DRAFT' },
  headerType: { type: String, enum: ['none', 'text', 'image', 'video', 'document'], default: 'none' },
  headerContent: String,
  headerMediaUrl: String,
  headerHandle: String,
  bodyText: { type: String, required: true },
  footerText: String,
  buttons: [templateButtonSchema],
  cards: [templateCardSchema],
  templateType: { type: String, enum: ['standard', 'media', 'carousel', 'authentication'], default: 'standard' },
  sampleValues: {
    body: [String],
    header: [String],
  },
  rejectionReason: String,
  qualityScore: { type: String, enum: ['GREEN', 'YELLOW', 'RED', null], default: null },
  submissionError: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

templateSchema.index({ tenantId: 1, name: 1, language: 1 }, { unique: true });
templateSchema.index({ tenantId: 1, status: 1 });
templateSchema.index({ metaTemplateId: 1 });

export const Template = mongoose.model('Template', templateSchema);
export default Template;