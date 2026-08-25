import { z } from 'zod';

export const createVariableSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores'),
      source: z.enum(['static', 'contact']).default('static'),
      contactField: z.string().max(100).nullish().default(null),
      staticValue: z.string().max(500).default(''),
      description: z.string().max(200).default(''),
    })
    .superRefine((val, ctx) => {
      if (val.source === 'contact' && !val.contactField) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactField'], message: 'Pick a contact field' });
      }
      if (val.source === 'static' && !String(val.staticValue ?? '').length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staticValue'], message: 'Static value is required' });
      }
    }),
});

export const updateVariableSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]+$/)
        .optional(),
      source: z.enum(['static', 'contact']).optional(),
      contactField: z.string().max(100).nullish(),
      staticValue: z.string().max(500).optional(),
      description: z.string().max(200).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
});

export const variableIdParam = z.object({
  params: z.object({ id: z.string().min(1) }),
});
