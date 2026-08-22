import mongoose from 'mongoose';

const creditWalletSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
  balance: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'suspended', 'frozen'], default: 'active' },
  lowCreditThreshold: { type: Number, default: 1000 },
}, { timestamps: true });

creditWalletSchema.index({ tenantId: 1 }, { unique: true });

export const CreditWallet = mongoose.model('CreditWallet', creditWalletSchema);
export default CreditWallet;