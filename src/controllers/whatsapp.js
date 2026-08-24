import { whatsAppConfigService } from '../modules/whatsapp/config.js';
import { templateService } from '../modules/whatsapp/template.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

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
    const { status, category, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.name = { $regex: String(search).toLowerCase(), $options: 'i' };
    const templates = await templateService.getTemplates(req.tenantId, filter);
    res.json({ templates, total: templates.length });
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

export const createTemplateController = async (req, res, next) => {
  try {
    const template = await templateService.createTemplate(req.tenantId, req.body);
    res.status(201).json(template);
  } catch (error) {
    next(error);
  }
};

export const updateTemplateController = async (req, res, next) => {
  try {
    const template = await templateService.updateTemplate(req.params.id, req.tenantId, stripMetaOnly(req.body));
    res.json(template);
  } catch (error) {
    next(error);
  }
};

export const deleteTemplateController = async (req, res, next) => {
  try {
    await templateService.deleteTemplate(req.params.id, req.tenantId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const submitTemplateController = async (req, res, next) => {
  try {
    // Upload media handles first — Meta rejects plain URLs for image headers
    await templateService.ensureMediaHandles(req.params.id, req.tenantId);
    const template = await templateService.submitToMeta(req.params.id, req.tenantId);
    res.json({ message: 'Template submitted to Meta for approval', template });
  } catch (error) {
    next(error);
  }
};
