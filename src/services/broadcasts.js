import { Broadcast } from '../models/Broadcast.js';
import { Template } from '../models/Template.js';
import { Contact } from '../models/Contact.js';
import { TemplateVariable } from '../models/TemplateVariable.js';
import { AppError } from '../middleware/errorHandler.js';
import { broadcastEngine } from '../modules/whatsapp/broadcast.js';
import { extractVariableIndices } from '../utils/template.js';

function audienceQuery(tenantId, audience = {}) {
  const where = {
    tenantId,
    optInStatus: 'opted_in',
    isBlocked: { $ne: true },
  };
  if (audience.type === 'tags') {
    where.tags = { $in: audience.tagIds || [] };
  }
  return where;
}

export const broadcastsService = {
  async previewCount(tenantId, audience) {
    return Contact.countDocuments(audienceQuery(tenantId, audience));
  },

  async createAndSend(tenantId, userId, payload) {
    const template = await Template.findOne({ _id: payload.templateId, tenantId });
    if (!template) throw new AppError('Template not found', 404);
    if (template.status !== 'APPROVED') throw new AppError('Only APPROVED templates can be sent', 400);

    // Every body variable position must have a binding
    const positions = extractVariableIndices(template.bodyText || '').map(Number);
    const boundPositions = new Set((payload.bindings?.body || []).map((b) => b.position));
    const missing = positions.filter((p) => !boundPositions.has(p));
    if (missing.length) {
      throw new AppError(`No value chosen for position(s): ${missing.map((p) => `{{${p}}}`).join(', ')}`, 400);
    }

    // Referenced variables must exist in this tenant
    const varIds = [...payload.bindings.body, payload.bindings.header]
      .filter((b) => b?.mode === 'variable')
      .map((b) => String(b.variableId));
    if (varIds.length) {
      const found = await TemplateVariable.countDocuments({ _id: { $in: varIds }, tenantId });
      if (found < new Set(varIds).size) throw new AppError('One of the selected variables no longer exists', 400);
    }

    const audienceCount = await this.previewCount(tenantId, payload.audience);
    if (!audienceCount) throw new AppError('No opted-in contacts match this audience', 400);

    const broadcast = await Broadcast.create({
      tenantId,
      name: payload.name?.trim() || `${template.name} — ${new Date().toLocaleDateString()}`,
      templateId: template._id,
      status: 'draft',
      audience: {
        type: payload.audience.type,
        tagIds: payload.audience.tagIds || [],
      },
      bindings: {
        body: [...payload.bindings.body].sort((a, b) => a.position - b.position),
        header: payload.bindings.header || null,
      },
      createdBy: userId,
    });

    // Kick off sending in the background — the engine batches with rate
    // limiting and can run for minutes on large audiences.
    setImmediate(() => {
      broadcastEngine.enqueueBroadcast(broadcast._id).catch(async (err) => {
        console.error('[broadcast] failed:', err.message);
        await Broadcast.findByIdAndUpdate(broadcast._id, {
          status: 'failed',
          errorMessage: err.message,
        }).catch(() => {});
      });
    });

    return { broadcast, audienceCount };
  },

  async list(tenantId, { page = 1, limit = 10 } = {}) {
    page = Math.max(parseInt(page, 10) || 1, 1);
    limit = Math.min(parseInt(limit, 10) || 10, 50);
    const [broadcasts, total] = await Promise.all([
      Broadcast.find({ tenantId })
        .populate('templateId', 'name status')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Broadcast.countDocuments({ tenantId }),
    ]);
    return { broadcasts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
  },

  async getOne(tenantId, id) {
    const broadcast = await Broadcast.findOne({ _id: id, tenantId }).populate('templateId', 'name status');
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    const stats = await broadcastEngine.getBroadcastStats(id);
    const pending = await BroadcastRecipientCount(id, 'pending');
    return { ...broadcast.toObject(), liveStats: stats, pending };
  },

  async pause(tenantId, id) {
    const broadcast = await Broadcast.findOne({ _id: id, tenantId });
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    await broadcastEngine.pauseBroadcast(id);
    return this.getOne(tenantId, id);
  },

  async resume(tenantId, id) {
    const broadcast = await Broadcast.findOne({ _id: id, tenantId });
    if (!broadcast) throw new AppError('Broadcast not found', 404);
    await broadcastEngine.resumeBroadcast(id);
    return this.getOne(tenantId, id);
  },
};

async function BroadcastRecipientCount(broadcastId, status) {
  const { BroadcastRecipient } = await import('../models/index.js');
  return BroadcastRecipient.countDocuments({ broadcastId, status });
}
