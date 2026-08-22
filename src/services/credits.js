import { CreditWallet, CreditTransaction } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const getWallet = async (tenantId) => {
  let wallet = await CreditWallet.findOne({ tenantId });
  if (!wallet) {
    wallet = await CreditWallet.create({ tenantId, balance: 0 });
  }
  return wallet;
};

export const getCreditHistory = async (tenantId, filters = {}) => {
  const page = parseInt(filters.page || 1, 10);
  const limit = parseInt(filters.limit || 20, 10);
  const { type, startDate, endDate } = filters;
  const skip = (page - 1) * limit;

  const wallet = await getWallet(tenantId);

  const where = { walletId: wallet._id };
  if (type) where.type = type;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.$gte = new Date(startDate);
    if (endDate) where.createdAt.$lte = new Date(endDate);
  }

  const [transactions, total] = await Promise.all([
    CreditTransaction.find(where)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    CreditTransaction.countDocuments(where),
  ]);

  return { transactions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const addCredit = async (tenantId, userId, data) => {
  const wallet = await getWallet(tenantId);

  if (wallet.status === 'suspended') {
    throw new AppError('Wallet is suspended', 403, 'CREDIT_SUSPENDED');
  }

  const transaction = await CreditTransaction.create({
    walletId: wallet._id,
    type: 'credit',
    amount: data.amount,
    method: data.method,
    reference: data.reference,
    description: data.description,
  });

  wallet.balance += data.amount;
  await wallet.save();

  return { ...transaction.toObject(), balanceAfter: wallet.balance };
};

export const transferCredit = async (fromTenantId, toTenantId, amount, description, userId) => {
  const fromWallet = await getWallet(fromTenantId);
  const toWallet = await getWallet(toTenantId);

  if (fromWallet.status === 'suspended' || toWallet.status === 'suspended') {
    throw new AppError('One or both wallets are suspended', 403);
  }

  if (fromWallet.balance < amount) {
    throw new AppError('Insufficient balance for transfer', 402, 'INSUFFICIENT_CREDITS');
  }

  const session = await CreditTransaction.startSession();
  session.startTransaction();

  try {
    await CreditTransaction.create([{
      walletId: fromWallet._id,
      type: 'debit',
      amount,
      method: 'Transfer',
      description: `Transfer to ${toTenantId}: ${description}`,
      reference: `TRF-${Date.now()}`,
    }], { session });

    await CreditTransaction.create([{
      walletId: toWallet._id,
      type: 'credit',
      amount,
      method: 'Transfer',
      description: `Transfer from ${fromTenantId}: ${description}`,
      reference: `TRF-${Date.now()}`,
    }], { session });

    fromWallet.balance -= amount;
    toWallet.balance += amount;
    await fromWallet.save({ session });
    await toWallet.save({ session });

    await session.commitTransaction();

    return { success: true, fromBalance: fromWallet.balance, toBalance: toWallet.balance };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const getPricing = async () => {
  return {
    text: 0.5,
    image: 1.0,
    video: 2.0,
    pdf: 1.5,
  };
};