import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
}, { timestamps: true });

refreshTokenSchema.index({ token: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;