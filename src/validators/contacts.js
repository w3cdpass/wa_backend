import { z } from 'zod';

export const createContactSchema = z.object({
  body: z.object({
    name: z.string().max(100).optional(),
    phoneNumber: z.string().min(7, 'Phone number too short').max(20),
    groupId: z.string().optional().nullable(),
    customFields: z.record(z.string()).optional(),
  }),
});

export const updateContactSchema = z.object({
  body: z.object({
    name: z.string().max(100).optional(),
    phoneNumber: z.string().min(7).max(20).optional(),
    groupId: z.string().optional().nullable(),
    customFields: z.record(z.string()).optional(),
    status: z.enum(['valid', 'invalid', 'opted_out', 'duplicate']).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const contactIdParam = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const listContactsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().optional(),
    groupId: z.string().optional(),
    status: z.enum(['valid', 'invalid', 'opted_out', 'duplicate']).optional(),
    source: z.string().optional(),
  }),
});

export const bulkDeleteContactsSchema = z.object({
  body: z.object({
    ids: z.array(z.string().min(1)).min(1, 'At least one ID required'),
  }),
});

export const createGroupSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Group name is required').max(100),
  }),
});

export const updateGroupSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const groupIdParam = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const listGroupsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});