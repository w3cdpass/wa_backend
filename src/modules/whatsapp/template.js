import { Template } from '../../models/Template.js';
import { Contact } from '../../models/Contact.js';
import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { whatsAppConfigService } from './config.js';
import { TemplateAPI, createTemplateAPI, buildTemplatePayload, buildSendComponents } from '../meta/index.js';
import { ensureHeaderHandle } from '../meta/uploads.js';
import { validateTemplateStructure, validateVariables } from '../../utils/template.js';

export class TemplateService {
  static deriveTemplateType(data) {
    if (data.cards?.length) return 'carousel';
    if (data.category === 'AUTHENTICATION') return 'authentication';
    if (['image', 'video', 'document'].includes(data.headerType)) return 'media';
    return 'standard';
  }

  async createTemplate(tenantId, data) {
    const template = await Template.create({
      tenantId,
      ...data,
      templateType: TemplateService.deriveTemplateType(data),
      status: 'DRAFT',
    });
    return template;
  }

  async updateTemplate(templateId, tenantId, data) {
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');
    if (!['DRAFT', 'REJECTED'].includes(template.status)) {
      throw new Error('Only DRAFT or REJECTED templates can be edited');
    }
    if (template.metaTemplateId && ['APPROVED', 'PENDING'].includes(template.status)) {
      throw new Error('Template already submitted — sync from Meta instead');
    }

    Object.assign(template, data, {
      templateType: TemplateService.deriveTemplateType({ ...template.toObject(), ...data }),
      submissionError: null,
      updatedAt: new Date(),
    });
    await template.save();
    return template;
  }

  async ensureMediaHandles(templateId, tenantId) {
    const config = await whatsAppConfigService.getConfig(tenantId);
    if (!config) throw new Error('WhatsApp not configured');
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');

    // Best-effort: Meta prefers example.header_handle (uploaded bytes), but
    // example.header_url is still accepted at creation — so an upload failure
    // (missing META_APP_ID, transient Graph error) must NOT block submission.
    try {
      await ensureHeaderHandle(template, config.accessToken);
      await template.save();
    } catch (err) {
      console.warn('[template] header handle upload skipped:', err.message);
    }
    return template;
  }

  async submitToMeta(templateId, tenantId) {
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');
    
    const config = await whatsAppConfigService.getConfig(tenantId);
    if (!config) throw new Error('WhatsApp not configured');
    
    const templateAPI = createTemplateAPI(config.accessToken);
    const payload = buildTemplatePayload(template);
    
    try {
      const result = await templateAPI.createTemplate(config.wabaId, config.accessToken, payload);
      
      template.metaTemplateId = result.id;
      template.status = 'PENDING';
      template.submissionError = null;
      await template.save();
      
      return template;
    } catch (error) {
      template.status = 'DRAFT';
      template.submissionError = error.message;
      await template.save();
      throw error;
    }
  }

  async syncFromMeta(tenantId) {
    const config = await whatsAppConfigService.getConfig(tenantId);
    if (!config) throw new Error('WhatsApp not configured');
    
    const templateAPI = createTemplateAPI(config.accessToken);
    const metaTemplates = await templateAPI.syncAllTemplates(config.wabaId, config.accessToken);
    
    let created = 0, updated = 0, errors = 0;
    const errorDetails = [];
    
    for (const metaTemplate of metaTemplates) {
      try {
        const existing = await Template.findOne({ 
          tenantId, 
          name: String(metaTemplate.name || '').toLowerCase(), // schema lowercases names on save
          language: metaTemplate.language 
        });
        
        const parsed = this.parseMetaTemplate(metaTemplate);
        
        if (existing) {
          await Template.findByIdAndUpdate(existing._id, { 
            $set: { ...parsed, metaTemplateId: metaTemplate.id, status: metaTemplate.status },
            updatedAt: new Date()
          });
          updated++;
        } else {
          await Template.create({ tenantId, ...parsed, metaTemplateId: metaTemplate.id, status: metaTemplate.status });
          created++;
        }
      } catch (e) {
        console.error('Template sync error:', e);
        errors++;
        errorDetails.push({ name: metaTemplate.name, message: e.message });
      }
    }
    
    await WhatsAppConfig.findOneAndUpdate({ tenantId }, { lastSyncAt: new Date() });
    
    return { total: metaTemplates.length, created, updated, errors, errorDetails };
  }

  parseMetaTemplate(meta) {
    const components = meta.components || [];
    const header = components.find(c => c.type === 'HEADER');
    const body = components.find(c => c.type === 'BODY');
    const footer = components.find(c => c.type === 'FOOTER');
    const buttons = components.find(c => c.type === 'BUTTONS');
    
    let headerType = 'none';
    let headerContent = null;
    let headerMediaUrl = null;
    let headerHandle = null;
    
    if (header) {
      if (header.format === 'TEXT') {
        headerType = 'text';
        headerContent = header.text;
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)) {
        headerType = header.format.toLowerCase();
        headerHandle = header.example?.header_handle?.[0];
      }
    }
    
    const parsedButtons = buttons?.buttons?.map(btn => ({
      type: btn.type,
      text: btn.text,
      url: btn.url,
      phoneNumber: btn.phone_number,
      example: Array.isArray(btn.example) ? btn.example[0] : btn.example,
      flowId: btn.flow_id,
      flowAction: btn.flow_action,
      catalogId: btn.catalog_id,
      productRetailerId: btn.product_retailer_id,
    })) || [];
    
    return {
      name: meta.name,
      category: ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(meta.category)
        ? meta.category
        : 'MARKETING',
      language: meta.language,
      status: meta.status,
      headerType,
      headerContent,
      headerHandle,
      bodyText: body?.text || '',
      footerText: footer?.text,
      buttons: parsedButtons,
      sampleValues: {
        body: body?.example?.body_text?.[0] || [],
        header: header?.example?.header_text || [],
      },
      qualityScore: this.normalizeQualityScore(meta.quality_score),
    };
  }

  normalizeQualityScore(qualityScore) {
    const raw = typeof qualityScore === 'string'
      ? qualityScore
      : qualityScore?.score;
    return ['GREEN', 'YELLOW', 'RED'].includes(raw) ? raw : null;
  }

  async deleteTemplate(templateId, tenantId) {
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');
    
    if (template.metaTemplateId) {
      const waConfig = await whatsAppConfigService.getConfig(tenantId);
      if (waConfig?.accessToken) {
        const templateAPI = createTemplateAPI(waConfig.accessToken);
        try {
          await templateAPI.deleteTemplate(template.metaTemplateId, waConfig.accessToken);
        } catch (e) {
          console.warn('Failed to delete from Meta:', e.message);
        }
      }
    }
    
    await Template.findByIdAndDelete(templateId);
    return true;
  }

  async getTemplates(tenantId, filter = {}) {
    const query = { tenantId, ...filter };
    return Template.find(query).sort({ createdAt: -1 });
  }

  async getTemplate(templateId, tenantId) {
    return Template.findOne({ _id: templateId, tenantId });
  }

  async validateSendParams(templateId, tenantId, params) {
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');
    
    if (template.status !== 'APPROVED') {
      throw new Error('Template must be APPROVED to send');
    }
    
    const { valid, errors } = validateVariables(template.bodyText, params.body || []);
    if (!valid) throw new Error(errors.join(', '));
    
    if (template.headerType === 'text' && extractVariableIndices(template.headerContent).length > 0) {
      if (!params.headerText) throw new Error('Header text variable required');
    }
    
    return true;
  }
}

import { extractVariableIndices } from '../../utils/template.js';
export const templateService = new TemplateService();