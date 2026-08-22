import { z } from 'zod';

export const addCreditSchema = z.object({
  body: z.object({
    amount: z.number().int().positive('Amount must be a positive integer'),
    method: z.enum(['UPI', 'Bank Transfer', 'Credit Card', 'Manual Adjustment', 'Other']),
    reference: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
  }),
});

export const transferCreditSchema = z.object({
  body: z.object({
    toTenantId: z.string().min(1, 'Target tenant ID is required'),
    amount: z.number().int().positive('Amount must be a positive integer'),
    description: z.string().max(500).optional(),
  }),
});

export const listCreditHistorySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    type: z.enum(['credit', 'debit']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  }),
});