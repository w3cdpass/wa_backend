import mongoose from 'mongoose';

const contactGroupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

contactGroupSchema.index({ tenantId: 1, name: 1 }, { unique: true });
contactGroupSchema.index({ tenantId: 1 });
contactGroupSchema.index({ userId: 1 });

export const ContactGroup = mongoose.model('ContactGroup', contactGroupSchema);
export default ContactGroup;