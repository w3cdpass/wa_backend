import { variablesService } from '../services/variables.js';

export const listVariablesController = async (req, res, next) => {
  try {
    const variables = await variablesService.list(req.tenantId, req.query.search);
    res.json({ variables });
  } catch (error) {
    next(error);
  }
};

export const createVariableController = async (req, res, next) => {
  try {
    const variable = await variablesService.create(req.tenantId, req.body);
    res.status(201).json(variable);
  } catch (error) {
    next(error);
  }
};

export const updateVariableController = async (req, res, next) => {
  try {
    const variable = await variablesService.update(req.params.id, req.tenantId, req.body);
    res.json(variable);
  } catch (error) {
    next(error);
  }
};

export const deleteVariableController = async (req, res, next) => {
  try {
    await variablesService.remove(req.params.id, req.tenantId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
