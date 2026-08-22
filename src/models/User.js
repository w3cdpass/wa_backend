import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  businessName: { type: String, trim: true },
  role: { type: String, enum: ['owner', 'admin', 'agent', 'viewer'], default: 'viewer' },
  metaUserId: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
  lastLoginAt: Date,
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
}, { timestamps: true });

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ tenantId: 1 });
userSchema.index({ tenantId: 1, role: 1 });

export const User = mongoose.model('User', userSchema);
export default User;