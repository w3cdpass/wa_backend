import {
  getWallet,
  getCreditHistory,
  addCredit,
  transferCredit,
  getPricing,
} from '../services/credits.js';
import { AppError } from '../middleware/errorHandler.js';

export const getWalletController = async (req, res, next) => {
  try {
    const wallet = await getWallet(req.tenantId);
    res.json(wallet);
  } catch (error) {
    next(error);
  }
};

export const getCreditHistoryController = async (req, res, next) => {
  try {
    const { page, limit, type, startDate, endDate } = req.query;
    const result = await getCreditHistory(req.tenantId, { page, limit, type, startDate, endDate });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const addCreditController = async (req, res, next) => {
  try {
    const { amount, method, reference, description } = req.body;
    const result = await addCredit(req.tenantId, req.user.id, { amount, method, reference, description });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const transferCreditController = async (req, res, next) => {
  try {
    const { toTenantId, amount, description } = req.body;
    const result = await transferCredit(req.tenantId, toTenantId, amount, description, req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getPricingController = async (req, res, next) => {
  try {
    const pricing = await getPricing();
    res.json(pricing);
  } catch (error) {
    next(error);
  }
};