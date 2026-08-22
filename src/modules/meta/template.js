import { MetaClient, MetaAPIError } from './client.js';
import { extractVariableIndices } from '../../utils/template.js';

export class TemplateAPI {
  constructor(metaClient) {
    this.client = metaClient;
  }

  async listTemplates(wabaId, accessToken, options = {}) {
    const { limit = 100, after, fields } = options;
    const client = new MetaClient(accessToken);
    
    let path = `/${wabaId}/message_templates?limit=${limit}`;
    if (after) path += `&after=${after}`;
    if (fields) path += `&fields=${fields}`;
    
    return client.get(path);
  }

  async getTemplate(templateId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.get(`/${templateId}?fields=id,name,language,status,category,components,quality_score`);
  }

  async createTemplate(wabaId, accessToken, templateData) {
    const client = new MetaClient(accessToken);
    return client.post(`/${wabaId}/message_templates`, templateData);
  }

  async submitTemplate(templateId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.post(`/${templateId}`, { status: 'SUBMITTED' });
  }

  async deleteTemplate(templateId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.delete(`/${templateId}`);
  }

  async syncAllTemplates(wabaId, accessToken) {
    const allTemplates = [];
    let nextUrl = null;
    let pageCount = 0;
    const MAX_PAGES = 50;

    do {
      pageCount++;
      const path = nextUrl || `/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`;
      
      const client = new MetaClient(accessToken);
      const response = await client.get(path.replace('https://graph.facebook.com/v21.0', ''));
      
      if (response.data) {
        allTemplates.push(...response.data);
      }
      
      nextUrl = response.paging?.next ? response.paging.next.replace('https://graph.facebook.com/v21.0', '') : null;
    } while (nextUrl && pageCount < MAX_PAGES);

    return allTemplates;
  }
}

export function buildTemplatePayload(template) {
  const components = [];

  if (template.headerType && template.headerType !== 'none') {
    const header = { type: 'HEADER', format: template.headerType.toUpperCase() };
    
    if (template.headerType === 'text' && template.headerContent) {
      header.text = template.headerContent;
      if (extractVariableIndices(template.headerContent).length > 0) {
        header.example = { header_text: [template.headerContent] };
      }
    } else if (['image', 'video', 'document'].includes(template.headerType)) {
      header.example = { header_handle: template.headerHandle ? [template.headerHandle] : [] };
    }
    
    components.push(header);
  }

  if (template.bodyText) {
    const body = { type: 'BODY', text: template.bodyText };
    const varCount = extractVariableIndices(template.bodyText).length;
    if (varCount > 0 && template.sampleValues?.body?.length) {
      body.example = { body_text: [template.sampleValues.body] };
    }
    components.push(body);
  }

  if (template.footerText) {
    components.push({ type: 'FOOTER', text: template.footerText });
  }

  if (template.buttons && template.buttons.length > 0) {
    const buttons = template.buttons.map((btn, index) => {
      const button = {
        type: btn.type,
        text: btn.text,
      };
      
      if (btn.type === 'URL') {
        button.url = btn.url;
        if (extractVariableIndices(btn.url).length > 0) {
          button.example = btn.example ? [btn.example] : [];
        }
      } else if (btn.type === 'PHONE_NUMBER') {
        button.phone_number = btn.phoneNumber;
      } else if (btn.type === 'COPY_CODE') {
        button.example = btn.example ? [btn.example] : [];
      } else if (btn.type === 'FLOW') {
        button.flow_id = btn.flowId;
        button.flow_action = btn.flowAction || 'NAVIGATE';
      } else if (btn.type === 'CATALOG') {
        button.catalog_id = btn.catalogId;
        button.product_retailer_id = btn.productRetailerId;
      }
      
      return button;
    });
    
    components.push({ type: 'BUTTONS', buttons });
  }

  return {
    name: template.name,
    category: template.category,
    language: template.language,
    components,
  };
}

export function buildSendComponents(template, params = {}) {
  const components = [];
  const { body, headerText, headerMediaUrl, headerMediaId, buttonParams } = params;

  if (template.headerType && template.headerType !== 'none') {
    if (template.headerType === 'text') {
      const varCount = extractVariableIndices(template.headerContent || '').length;
      if (varCount > 0) {
        if (!headerText?.trim()) {
          throw new Error('Header text variable requires a value');
        }
        components.push({
          type: 'header',
          parameters: [{ type: 'text', text: headerText }],
        });
      }
    } else {
      const link = headerMediaUrl || template.headerMediaUrl;
      const id = headerMediaId;
      if (!link && !id) {
        throw new Error(`${template.headerType} header requires a media link or id`);
      }
      components.push({
        type: 'header',
        parameters: [{
          type: template.headerType,
          [template.headerType]: id ? { id } : { link },
        }],
      });
    }
  }

  if (template.bodyText) {
    const varCount = extractVariableIndices(template.bodyText).length;
    const bodyValues = body || [];
    if (bodyValues.length < varCount) {
      throw new Error(`Body has ${varCount} variable(s) but only ${bodyValues.length} value(s) supplied`);
    }
    components.push({
      type: 'body',
      parameters: bodyValues.slice(0, varCount).map(text => ({ type: 'text', text: String(text) })),
    });
  }

  if (template.buttons && template.buttons.length > 0) {
    template.buttons.forEach((btn, index) => {
      const override = buttonParams?.[index];
      
      if (btn.type === 'URL' && extractVariableIndices(btn.url).length > 0) {
        if (!override?.trim()) {
          throw new Error(`URL button #${index + 1} requires a buttonParams value`);
        }
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{ type: 'text', text: override }],
        });
      } else if (btn.type === 'COPY_CODE') {
        components.push({
          type: 'button',
          sub_type: 'copy_code',
          index: String(index),
          parameters: [{ type: 'coupon_code', coupon_code: override?.trim() || btn.example }],
        });
      } else if (btn.type === 'QUICK_REPLY' && override) {
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(index),
          parameters: [{ type: 'payload', payload: override }],
        });
      }
    });
  }

  return components;
}

export function createTemplateAPI(accessToken) {
  const client = new MetaClient(accessToken);
  return new TemplateAPI(client);
}