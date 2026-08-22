import mongoose from 'mongoose';

const mediaSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String, required: true },
  fileSize: { type: Number, required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

mediaSchema.index({ tenantId: 1 });
mediaSchema.index({ userId: 1 });

export const Media = mongoose.model('Media', mediaSchema);
export default Media;