import {
  listContacts,
  createContact,
  getContactById,
  updateContact,
  deleteContact,
  bulkDeleteContacts,
  bulkImportContacts,
  listGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
  listTags,
} from '../services/contacts.js';
import { AppError } from '../middleware/errorHandler.js';

export const listContactsController = async (req, res, next) => {
  try {
    const { page, limit, search, groupId, status, source } = req.query;
    const result = await listContacts(req.tenantId, { page, limit, search, groupId, status, source });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const createContactController = async (req, res, next) => {
  try {
    const contact = await createContact(req.tenantId, req.user.id, req.body);
    res.status(201).json(contact);
  } catch (error) {
    next(error);
  }
};

export const getContactController = async (req, res, next) => {
  try {
    const contact = await getContactById(req.tenantId, req.params.id);
    res.json(contact);
  } catch (error) {
    next(error);
  }
};

export const updateContactController = async (req, res, next) => {
  try {
    const contact = await updateContact(req.tenantId, req.params.id, req.body);
    res.json(contact);
  } catch (error) {
    next(error);
  }
};

export const deleteContactController = async (req, res, next) => {
  try {
    await deleteContact(req.tenantId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const bulkDeleteContactsController = async (req, res, next) => {
  try {
    const { ids } = req.body;
    const result = await bulkDeleteContacts(req.tenantId, ids);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const bulkImportContactsController = async (req, res, next) => {
  try {
    const { rows, source = 'csv' } = req.body;
    if (!rows || !Array.isArray(rows)) {
      throw new AppError('Rows array is required', 400);
    }
    const result = await bulkImportContacts(req.tenantId, req.user.id, rows, source);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const listGroupsController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await listGroups(req.tenantId, { page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const createGroupController = async (req, res, next) => {
  try {
    const group = await createGroup(req.tenantId, req.user.id, req.body.name);
    res.status(201).json(group);
  } catch (error) {
    next(error);
  }
};

export const getGroupController = async (req, res, next) => {
  try {
    const group = await getGroupById(req.tenantId, req.params.id);
    res.json(group);
  } catch (error) {
    next(error);
  }
};

export const updateGroupController = async (req, res, next) => {
  try {
    const group = await updateGroup(req.tenantId, req.params.id, req.body.name);
    res.json(group);
  } catch (error) {
    next(error);
  }
};

export const deleteGroupController = async (req, res, next) => {
  try {
    await deleteGroup(req.tenantId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const listContactTagsController = async (req, res, next) => {
  try {
    const tags = await listTags(req.tenantId);
    res.json({ tags: tags.filter(Boolean) });
  } catch (error) {
    next(error);
  }
};
