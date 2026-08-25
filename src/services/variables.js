import { TemplateVariable } from '../models/TemplateVariable.js';
import { AppError } from '../middleware/errorHandler.js';

export const variablesService = {
  async list(tenantId, search) {
    const where = { tenantId };
    if (search) {
      const rx = { $regex: String(search).toLowerCase(), $options: 'i' };
      where.$or = [{ name: rx }, { description: rx }];
    }
    return TemplateVariable.find(where).sort({ createdAt: -1 });
  },

  async create(tenantId, data) {
    const exists = await TemplateVariable.findOne({ tenantId, name: data.name });
    if (exists) throw new AppError(`Variable "${data.name}" already exists`, 409);
    return TemplateVariable.create({ tenantId, ...data });
  },

  async update(id, tenantId, data) {
    if (data.name) {
      const dupe = await TemplateVariable.findOne({
        tenantId,
        name: data.name,
        _id: { $ne: id },
      });
      if (dupe) throw new AppError(`Variable "${data.name}" already exists`, 409);
    }
    const variable = await TemplateVariable.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: data },
      { new: true, runValidators: true }
    );
    if (!variable) throw new AppError('Variable not found', 404);
    return variable;
  },

  async remove(id, tenantId) {
    const variable = await TemplateVariable.findOneAndDelete({ _id: id, tenantId });
    if (!variable) throw new AppError('Variable not found', 404);
    return variable;
  },
};
