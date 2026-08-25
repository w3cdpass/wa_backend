import { z } from 'zod';

const bindingSchema = z
  .object({
    position: z.coerce.number().int().min(1),
    mode: z.enum(['variable', 'fixed']),
    variableId: z.string().min(1).optional(),
    value: z.string().max(500).optional(),
  })
  .refine((b) => (b.mode === 'variable' ? !!b.variableId : b.value !== undefined && b.value !== null), {
    message: 'Pick a variable or enter a fixed value',
  });

export const createBroadcastSchema = z.object({
  body: z.object({
    name: z.string().trim().max(100).optional(),
    templateId: z.string().min(1),
    audience: z.object({
      type: z.enum(['all', 'tags']),
      tagIds: z.array(z.string()).default([]),
    }).refine((a) => a.type !== 'tags' || a.tagIds.length > 0, {
      message: 'Select at least one tag',
      path: ['tagIds'],
    }),
    bindings: z.object({
      body: z.array(bindingSchema).min(0),
      header: z
        .object({
          mode: z.enum(['variable', 'fixed']),
          variableId: z.string().min(1).optional(),
          value: z.string().max(60).optional(),
        })
        .refine((b) => (b.mode === 'variable' ? !!b.variableId : true), {
          message: 'Pick a variable for the header',
        })
        .nullish(),
    }),
  }),
});

export const broadcastIdParam = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const previewCountSchema = z.object({
  body: z.object({
    audience: z.object({
      type: z.enum(['all', 'tags']),
      tagIds: z.array(z.string()).default([]),
    }),
  }),
});
