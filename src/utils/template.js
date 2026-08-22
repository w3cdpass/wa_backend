export function extractVariableIndices(text) {
  if (!text) return [];
  const matches = text.match(/\{\{(\d+)\}\}/g);
  if (!matches) return [];
  return matches.map(m => parseInt(m.replace(/\{\{(\d+)\}\}/, '$1'), 10))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b);
}

export function validateVariables(templateText, variables) {
  const indices = extractVariableIndices(templateText);
  const errors = [];
  
  for (const index of indices) {
    if (variables[index - 1] === undefined || variables[index - 1] === null) {
      errors.push(`Variable {{${index}} is required but not provided`);
    }
  }
  
  if (variables.length > indices.length) {
    errors.push(`Too many variables provided (max ${indices.length})`);
  }
  
  return { valid: errors.length === 0, errors };
}

export function interpolateTemplate(templateText, variables) {
  if (!templateText) return '';
  return templateText.replace(/\{\{(\d+)\}\}/g, (match, index) => {
    const idx = parseInt(index, 10) - 1;
    return variables[idx] !== undefined ? String(variables[idx]) : match;
  });
}

export const TEMPLATE_LIMITS = {
  bodyMaxLength: 1024,
  headerTextMaxLength: 60,
  footerMaxLength: 60,
  buttonTitleMaxLength: 20,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  maxButtons: 3,
  maxListSections: 10,
  maxListRowsTotal: 10,
  maxListButtonTitleLength: 20,
};

export function validateTemplateStructure(template) {
  const errors = [];
  
  if (template.bodyText && template.bodyText.length > TEMPLATE_LIMITS.bodyMaxLength) {
    errors.push(`Body text exceeds ${TEMPLATE_LIMITS.bodyMaxLength} characters`);
  }
  
  if (template.headerType === 'text' && template.headerContent) {
    if (template.headerContent.length > TEMPLATE_LIMITS.headerTextMaxLength) {
      errors.push(`Header text exceeds ${TEMPLATE_LIMITS.headerTextMaxLength} characters`);
    }
  }
  
  if (template.footerText && template.footerText.length > TEMPLATE_LIMITS.footerMaxLength) {
    errors.push(`Footer text exceeds ${TEMPLATE_LIMITS.footerMaxLength} characters`);
  }
  
  if (template.buttons) {
    if (template.buttons.length > TEMPLATE_LIMITS.maxButtons) {
      errors.push(`Maximum ${TEMPLATE_LIMITS.maxButtons} buttons allowed`);
    }
    
    for (const btn of template.buttons) {
      if (btn.text.length > TEMPLATE_LIMITS.buttonTitleMaxLength) {
        errors.push(`Button text "${btn.text}" exceeds ${TEMPLATE_LIMITS.buttonTitleMaxLength} characters`);
      }
      
      if (btn.type === 'URL' && btn.url) {
        try {
          new URL(btn.url);
        } catch {
          errors.push(`Invalid URL in button: ${btn.url}`);
        }
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

export const META_TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
export const META_TEMPLATE_LANGUAGES = [
  'en_US', 'en_GB', 'en', 'es', 'es_ES', 'es_MX', 'fr', 'fr_FR', 'de', 'it',
  'pt_BR', 'pt_PT', 'nl', 'pl', 'ru', 'tr', 'ar', 'hi', 'bn', 'ta', 'te',
  'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as', 'sa', 'zh_CN', 'zh_TW', 'ja', 'ko',
];