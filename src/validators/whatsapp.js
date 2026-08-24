import { z } from 'zod';

export const TEMPLATE_BUTTON_TYPES = ['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE', 'FLOW', 'CATALOG'];

const buttonSchema = z.object({
  type: z.enum(TEMPLATE_BUTTON_TYPES),
  text: z.string().min(1, 'Button text is required').max(25, 'Button text max 25 characters'),
  url: z.string().url().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  example: z.string().optional().nullable(),
  flowId: z.string().optional().nullable(),
  flowAction: z.enum(['NAVIGATE', 'DATA_EXCHANGE']).optional().nullable(),
  catalogId: z.string().optional().nullable(),
  productRetailerId: z.string().optional().nullable(),
}).superRefine((btn, ctx) => {
  if (btn.type === 'URL' && !btn.url) ctx.addIssue({ code: 'custom', message: 'Website URL is required', path: ['url'] });
  if (btn.type === 'PHONE_NUMBER' && !btn.phoneNumber) ctx.addIssue({ code: 'custom', message: 'Phone number is required', path: ['phoneNumber'] });
  if (btn.type === 'FLOW' && !btn.flowId) ctx.addIssue({ code: 'custom', message: 'Flow ID is required', path: ['flowId'] });
  if (btn.type === 'CATALOG' && !btn.catalogId) ctx.addIssue({ code: 'custom', message: 'Catalog ID is required', path: ['catalogId'] });
});

const cardSchema = z.object({
  headerMediaUrl: z.string().url('Card image URL is required'),
  bodyText: z.string().min(1, 'Card body text is required').max(160, 'Card body max 160 characters'),
  buttons: z.array(buttonSchema).max(2, 'Max 2 buttons per card').default([]),
});

export const createTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only'),
    category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
    language: z.string().min(2),
    templateType: z.enum(['standard', 'media', 'carousel', 'authentication']).default('standard'),
    headerType: z.enum(['none', 'text', 'image', 'video', 'document']).default('none'),
    headerContent: z.string().max(60).optional().nullable(),
    headerMediaUrl: z.string().url().optional().nullable(),
    headerHandle: z.string().optional().nullable(),
    bodyText: z.string().min(1, 'Body text is required').max(1024, 'Body max 1024 characters'),
    footerText: z.string().max(60).optional().nullable(),
    buttons: z.array(buttonSchema).default([]),
    cards: z.array(cardSchema).default([]),
    sampleValues: z.object({
      body: z.array(z.string()).default([]),
      header: z.array(z.string()).default([]),
    }).optional(),
  }).superRefine((data, ctx) => {
    const nonQuick = data.buttons.filter(b => b.type !== 'QUICK_REPLY').length;
    const quick = data.buttons.filter(b => b.type === 'QUICK_REPLY').length;
    const catalog = data.buttons.filter(b => b.type === 'CATALOG').length;
    const flow = data.buttons.filter(b => b.type === 'FLOW').length;

    if (nonQuick > 3) ctx.addIssue({ code: 'custom', message: 'Max 3 URL / Phone / Copy-code buttons combined', path: ['buttons'] });
    if (catalog > 1) ctx.addIssue({ code: 'custom', message: 'Only one catalog button allowed', path: ['buttons'] });
    if (flow > 1) ctx.addIssue({ code: 'custom', message: 'Only one flow button allowed', path: ['buttons'] });
    if (data.buttons.length > 10) ctx.addIssue({ code: 'custom', message: 'Max 10 buttons total', path: ['buttons'] });

    if (data.templateType === 'carousel') {
      if (!['MARKETING'].includes(data.category)) {
        ctx.addIssue({ code: 'custom', message: 'Carousel templates must be MARKETING category', path: ['category'] });
      }
      if (data.cards.length < 2 || data.cards.length > 10) {
        ctx.addIssue({ code: 'custom', message: 'Carousel needs 2-10 cards', path: ['cards'] });
      }
      if (data.buttons.length) {
        ctx.addIssue({ code: 'custom', message: 'Top-level buttons are not allowed on carousel — use per-card buttons', path: ['buttons'] });
      }
    } else {
      if (data.headerType === 'text' && !data.headerContent?.trim()) {
        ctx.addIssue({ code: 'custom', message: 'Header text is required', path: ['headerContent'] });
      }
      if (['image', 'video', 'document'].includes(data.headerType) && !data.headerMediaUrl && !data.headerHandle) {
        ctx.addIssue({ code: 'custom', message: 'Media URL is required for this header type', path: ['headerMediaUrl'] });
      }
    }
  }),
});

export const updateTemplateSchema = createTemplateSchema;

export const templateIdParam = z.object({
  params: z.object({ id: z.string().min(1) }),
});
