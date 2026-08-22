import mongoose from 'mongoose';

const creditTransactionSchema = new mongoose.Schema({
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditWallet', required: true },
  type: { type: String, enum: ['credit', 'debit', 'transfer'], required: true },
  amount: { type: Number, required: true },
  method: { type: String },
  description: { type: String },
  reference: { type: String },
}, { timestamps: true });

creditTransactionSchema.index({ walletId: 1, createdAt: -1 });
creditTransactionSchema.index({ reference: 1 });

export const CreditTransaction = mongoose.model('CreditTransaction', creditTransactionSchema);
export default CreditTransaction;