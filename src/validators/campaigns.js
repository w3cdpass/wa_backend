import { z } from 'zod';

export const createCampaignSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Campaign name is required').max(200),
    message: z.string().min(1, 'Message is required').max(4096),
    mediaType: z.enum(['none', 'image', 'video', 'pdf']).default('none'),
    mediaUrl: z.string().url().optional().nullable(),
    mediaName: z.string().optional().nullable(),
    totalContacts: z.number().int().min(1, 'At least 1 contact required'),
    scheduledAt: z.string().datetime().optional().nullable(),
    saveAsDraft: z.boolean().default(false),
    contactIds: z.array(z.string()).optional(),
    groupIds: z.array(z.string()).optional(),
  }),
});

export const updateCampaignSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    message: z.string().min(1).max(4096).optional(),
    mediaType: z.enum(['none', 'image', 'video', 'pdf']).optional(),
    mediaUrl: z.string().url().optional().nullable(),
    mediaName: z.string().optional().nullable(),
    scheduledAt: z.string().datetime().optional().nullable(),
    contactIds: z.array(z.string()).optional(),
    groupIds: z.array(z.string()).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const campaignIdParam = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const listCampaignsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(['draft', 'scheduled', 'processing', 'sent', 'completed', 'paused', 'cancelled', 'failed']).optional(),
    search: z.string().optional(),
    type: z.enum(['instant', 'scheduled', 'draft']).optional(),
  }),
});

export const scheduleCampaignSchema = z.object({
  body: z.object({
    scheduledAt: z.string().datetime(),
  }),
  params: z.object({
    campaignId: z.string().min(1),
  }),
});

export const previewRecipientsSchema = z.object({
  body: z.object({
    contactIds: z.array(z.string()).optional(),
    groupIds: z.array(z.string()).optional(),
    fileId: z.string().optional(),
  }),
});