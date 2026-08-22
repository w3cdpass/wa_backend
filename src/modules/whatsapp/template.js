import { Template } from '../../models/Template.js';
import { Contact } from '../../models/Contact.js';
import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { TemplateAPI, createTemplateAPI, buildTemplatePayload, buildSendComponents } from '../meta/index.js';
import { validateTemplateStructure, validateVariables } from '../../utils/template.js';

export class TemplateService {
  async createTemplate(tenantId, data) {
    const { valid, errors } = validateTemplateStructure(data);
    if (!valid) throw new Error(errors.join(', '));
    
    const template = await Template.create({ tenantId, ...data, status: 'DRAFT' });
    return template;
  }

  async updateTemplate(templateId, tenantId, data) {
    const { valid, errors } = validateTemplateStructure(data);
    if (!valid) throw new Error(errors.join(', '));
    
    const template = await Template.findOneAndUpdate(
      { _id: templateId, tenantId },
      { $set: data },
      { new: true, runValidators: true }
    );
    
    if (!template) throw new Error('Template not found');
    return template;
  }

  async submitToMeta(templateId, tenantId) {
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');
    
    const config = await WhatsAppConfig.findOne({ tenantId });
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
    const config = await WhatsAppConfig.findOne({ tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    
    const templateAPI = createTemplateAPI(config.accessToken);
    const metaTemplates = await templateAPI.syncAllTemplates(config.wabaId, config.accessToken);
    
    let created = 0, updated = 0, errors = 0;
    
    for (const metaTemplate of metaTemplates) {
      try {
        const existing = await Template.findOne({ 
          tenantId, 
          name: metaTemplate.name, 
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
      }
    }
    
    await WhatsAppConfig.findOneAndUpdate({ tenantId }, { lastSyncAt: new Date() });
    
    return { total: metaTemplates.length, created, updated, errors };
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
      category: meta.category,
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
      qualityScore: meta.quality_score?.score || null,
    };
  }

  async deleteTemplate(templateId, tenantId) {
    const template = await Template.findOne({ _id: templateId, tenantId });
    if (!template) throw new Error('Template not found');
    
    if (template.metaTemplateId) {
      const config = await WhatsAppConfig.findOne({ tenantId });
      if (config?.accessToken) {
        const templateAPI = createTemplateAPI(config.accessToken);
        try {
          await templateAPI.deleteTemplate(template.metaTemplateId, config.accessToken);
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