import { whatsAppConfigService } from '../modules/whatsapp/config.js';
import { templateService } from '../modules/whatsapp/template.js';
import { listSubscribedApps, subscribeAppToWaba } from '../modules/meta/subscriptions.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { checkTemplateCompliance } from '../utils/templateCompliance.js';

export const getWaConfigController = async (req, res, next) => {
  try {
    const masked = await whatsAppConfigService.getMaskedConfig(req.tenantId);
    res.json({
      configured: !!masked,
      config: masked,
      webhook: {
        callbackUrl: `${config.appUrl}${config.webhookPath}`,
        webhookFields: {
          callbackUrl: `${config.appUrl}${config.webhookPath}`,
          verifyTokenDescription: 'Copy the verify token below into Meta > WhatsApp > Configuration',
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const saveWaConfigController = async (req, res, next) => {
  try {
    await whatsAppConfigService.saveConfig(req.tenantId, req.body);
    const masked = await whatsAppConfigService.getMaskedConfig(req.tenantId);
    res.json({ message: 'Credentials saved', config: masked });
  } catch (error) {
    next(error);
  }
};

export const connectWaController = async (req, res, next) => {
  try {
    const result = await whatsAppConfigService.testConnection(req.tenantId);
    if (!result.success) throw new AppError(result.error || 'Connection failed', 400, 'WA_CONNECT_FAILED');

    // Best-effort template import so the catalog is populated immediately
    let templateSync = null;
    try {
      templateSync = await templateService.syncFromMeta(req.tenantId);
    } catch (e) {
      console.warn('Post-connect template sync failed:', e.message);
    }

    const masked = await whatsAppConfigService.getMaskedConfig(req.tenantId);
    res.json({
      message: 'WhatsApp connected successfully',
      connection: {
        displayPhoneNumber: result.displayPhoneNumber,
        verifiedName: result.verifiedName,
        qualityRating: result.qualityRating,
        isRegistered: result.isRegistered,
        status: masked?.status,
      },
      config: masked,
      templateSync,
    });
  } catch (error) {
    next(error);
  }
};

export const disconnectWaController = async (req, res, next) => {
  try {
    await whatsAppConfigService.disconnect(req.tenantId);
    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (error) {
    next(error);
  }
};

export const getWebhookInfoController = async (req, res, next) => {
  try {
    const wa = await whatsAppConfigService.ensureVerifyToken(req.tenantId);
    const callbackUrl = `${config.appUrl}${config.webhookPath}`;
    res.json({
      callbackUrl,
      verifyToken: wa.verifyToken,
      metaSetupSteps: [
        'Open Meta for Developers > your app > WhatsApp > Configuration',
        `Paste "${callbackUrl}" as Callback URL`,
        `Paste the verify token below and click "Verify and save"`,
        'Subscribe to the "messages" webhook field',
      ],
    });
  } catch (error) {
    next(error);
  }
};

export const syncTemplatesController = async (req, res, next) => {
  try {
    const result = await templateService.syncFromMeta(req.tenantId);
    res.json({ message: 'Templates synced from Meta', ...result });
  } catch (error) {
    next(error);
  }
};

export const listTemplatesController = async (req, res, next) => {
  try {
    const { status, category, search, page, limit } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    const result = await templateService.getTemplates(req.tenantId, filter, { search, page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getTemplateController = async (req, res, next) => {
  try {
    const template = await templateService.getTemplate(req.params.id, req.tenantId);
    if (!template) throw new AppError('Template not found', 404);
    res.json(template);
  } catch (error) {
    next(error);
  }
};

const stripMetaOnly = (data) => ({
  ...data,
  headerHandle: undefined,
  cards: data.cards?.map(({ headerHandle, ...rest }) => rest),
});

// Template endpoints must surface real failure causes — never a bare
// "Internal server error". Anything without a statusCode is a client-fixable
// problem (bad media URL, missing config) or a Meta rejection.
const normalizeTemplateError = (error) => {
  if (!error.statusCode) {
    error.statusCode = /not found/i.test(error.message || '') ? 404 : 400;
  }
  return error;
};

export const createTemplateController = async (req, res, next) => {
  try {
    const template = await templateService.createTemplate(req.tenantId, req.body);
    res.status(201).json(template);
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};

export const updateTemplateController = async (req, res, next) => {
  try {
    const template = await templateService.updateTemplate(req.params.id, req.tenantId, stripMetaOnly(req.body));
    res.json(template);
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};

export const deleteTemplateController = async (req, res, next) => {
  try {
    await templateService.deleteTemplate(req.params.id, req.tenantId);
    res.json({ success: true });
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};

// Best-practices gate before spending a review attempt with Meta.
export const checkComplianceController = async (req, res, next) => {
  try {
    const report = checkTemplateCompliance(req.body);
    res.json(report);
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};

// Instant template-status webhooks, enabled from inside the app with the
// stored token — no Meta dashboard access required.
const requireWaConfig = async (tenantId) => {
  const cfg = await whatsAppConfigService.getConfig(tenantId);
  if (!cfg?.accessToken || !cfg?.wabaId) {
    throw new AppError('Save your WhatsApp credentials first (access token + WABA ID)', 400);
  }
  return cfg;
};

export const getWebhookSubscriptionController = async (req, res, next) => {
  try {
    const cfg = await requireWaConfig(req.tenantId);
    const apps = await listSubscribedApps(cfg.wabaId, cfg.accessToken);
    res.json({ subscribed: apps.length > 0, apps });
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};

export const subscribeWebhookController = async (req, res, next) => {
  try {
    const cfg = await requireWaConfig(req.tenantId);
    await subscribeAppToWaba(cfg.wabaId, cfg.accessToken);
    const apps = await listSubscribedApps(cfg.wabaId, cfg.accessToken);
    res.json({ success: true, subscribed: apps.length > 0, apps });
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};

export const submitTemplateController = async (req, res, next) => {
  try {
    const existing = await templateService.getTemplate(req.params.id, req.tenantId);
    if (!existing) throw new AppError('Template not found', 404);
    if (existing.status === 'PENDING') throw new AppError('Template is already pending review and locked by Meta', 400);

    const report = checkTemplateCompliance(existing);
    if (!report.passed) {
      throw new AppError(
        `Fix these issues before submitting to Meta: ${report.errors.map((e) => e.message).join(' | ')}`,
        400,
      );
    }

    // Upload media handles first — Meta rejects plain URLs for image headers
    await templateService.ensureMediaHandles(req.params.id, req.tenantId);
    const template = await templateService.submitToMeta(req.params.id, req.tenantId);
    res.json({
      message: 'Template submitted to Meta for approval',
      template,
      review: { warnings: report.warnings, tips: report.tips },
    });
  } catch (error) {
    next(normalizeTemplateError(error));
  }
};
