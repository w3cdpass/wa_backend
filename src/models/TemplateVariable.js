import mongoose from 'mongoose';

// Tenant-wide reusable variable definitions. Templates use positional
// placeholders ({{1}}, {{2}}…); at send time each position can be bound to
// one of these variables — either a static value ("20% OFF") or a per-contact
// field (contact.name / customFields.city) resolved by the broadcast engine.
const templateVariableSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true, lowercase: true },
    // static  -> same value for every recipient
    // contact -> resolved per recipient from Contact data
    source: { type: String, enum: ['static', 'contact'], required: true, default: 'static' },
    // for source=contact: 'name' | 'phone' | 'tags' | 'customFields.<key>'
    contactField: { type: String, default: null },
    staticValue: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

templateVariableSchema.index({ tenantId: 1, name: 1 }, { unique: true });

templateVariableSchema.statics.resolve = function (variable, contact) {
  if (!variable) return '';
  if (variable.source === 'contact') {
    const field = variable.contactField || '';
    if (field.startsWith('customFields.')) {
      const key = field.slice('customFields.'.length);
      const value = contact?.customFields?.[key];
      return value === undefined || value === null ? '' : String(value);
    }
    const value = contact?.[field];
    return value === undefined || value === null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  }
  return variable.staticValue ?? '';
};

export const TemplateVariable = mongoose.model('TemplateVariable', templateVariableSchema);
