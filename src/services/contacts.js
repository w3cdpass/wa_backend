import { Contact, ContactGroup } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

export const listContacts = async (tenantId, filters = {}) => {
  const page = parseInt(filters.page || 1, 10);
  const limit = parseInt(filters.limit || 20, 10);
  const { search, groupId, status, source } = filters;
  const skip = (page - 1) * limit;

  const where = { tenantId };
  if (groupId) where.groupId = groupId;
  if (status) where.status = status;
  if (source) where.source = source;
  if (search) {
    where.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search } },
    ];
  }

  const [contacts, total] = await Promise.all([
    Contact.find(where)
      .populate('groupId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Contact.countDocuments(where),
  ]);

  return { contacts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const createContact = async (tenantId, userId, data) => {
  const existing = await Contact.findOne({ phone: data.phone, tenantId });
  if (existing) throw new AppError('Contact with this phone number already exists', 409);

  return Contact.create({
    ...data,
    phone: data.phone,
    userId,
    tenantId,
    source: data.source || 'manual',
    status: data.status || 'valid',
  });
};

export const getContactById = async (tenantId, id) => {
  const contact = await Contact.findOne({ _id: id, tenantId }).populate('groupId');
  if (!contact) throw new AppError('Contact not found', 404);
  return contact;
};

export const updateContact = async (tenantId, id, data) => {
  const contact = await Contact.findOne({ _id: id, tenantId });
  if (!contact) throw new AppError('Contact not found', 404);

  if (data.phone && data.phone !== contact.phone) {
    const existing = await Contact.findOne({ phone: data.phone, tenantId });
    if (existing) throw new AppError('Phone number already exists', 409);
  }

  return Contact.findByIdAndUpdate(id, { ...data, updatedAt: new Date() }, { new: true });
};

export const deleteContact = async (tenantId, id) => {
  const contact = await Contact.findOne({ _id: id, tenantId });
  if (!contact) throw new AppError('Contact not found', 404);
  await Contact.findByIdAndDelete(id);
  return { success: true };
};

export const bulkDeleteContacts = async (tenantId, ids) => {
  const result = await Contact.deleteMany({ _id: { $in: ids }, tenantId });
  return { success: true, count: result.deletedCount };
};

export const bulkImportContacts = async (tenantId, userId, rows, source) => {
  const seenPhones = new Set();
  const existingContacts = await Contact.find({ tenantId }).select('phone');
  existingContacts.forEach(c => seenPhones.add(c.phone.replace(/\s/g, '')));

  const existingGroups = await ContactGroup.find({ tenantId }).select('_id name');
  const groupByName = new Map(existingGroups.map(g => [g.name.toLowerCase(), g._id]));

  const imported = [];
  let duplicates = 0;
  let invalid = 0;

  for (const row of rows) {
    const phone = String(row.phone || row.Phone || row.mobile || row.Mobile || '').trim();
    const name = String(row.name || row.Name || 'Unknown').trim();
    const normalized = phone.replace(/\s/g, '');

    if (!phone || phone.length < 7) {
      invalid++;
      continue;
    }
    if (seenPhones.has(normalized)) {
      duplicates++;
      continue;
    }
    seenPhones.add(normalized);

    const groupName = String(row.group || row.Group || 'Imported').trim();
    let groupId = groupByName.get(groupName.toLowerCase());
    if (!groupId) {
      const created = await ContactGroup.create({ data: { name: groupName, tenantId, userId } });
      groupId = created._id;
      groupByName.set(groupName.toLowerCase(), groupId);
    }

    imported.push({
      name,
      phone: phone,
      groupId,
      source,
      status: 'valid',
      userId,
      tenantId,
    });
  }

  if (imported.length > 0) {
    await Contact.insertMany(imported);
  }

  return {
    totalRows: rows.length,
    imported: imported.length,
    duplicates,
    invalid,
  };
};

export const listGroups = async (tenantId, filters = {}) => {
  const page = parseInt(filters.page || 1, 10);
  const limit = parseInt(filters.limit || 50, 10);
  const skip = (page - 1) * limit;

  const [groups, total] = await Promise.all([
    ContactGroup.aggregate([
      { $match: { tenantId: tenantId } },
      {
        $lookup: {
          from: 'contacts',
          localField: '_id',
          foreignField: 'groupId',
          as: 'contacts',
        },
      },
      { $addFields: { count: { $size: '$contacts' } } },
      { $sort: { createdAt: -1 } },
      { $skip: (parseInt(filters.page || 1, 10) - 1) * parseInt(filters.limit || 50, 10) },
      { $limit: parseInt(filters.limit || 50, 10) },
      { $project: { name: 1, count: 1, createdAt: 1, updatedAt: 1 } },
    ]),
    ContactGroup.countDocuments({ tenantId }),
  ]);

  return { groups, pagination: { page: parseInt(filters.page || 1, 10), limit: parseInt(filters.limit || 50, 10), total, totalPages: Math.ceil(total / parseInt(filters.limit || 50, 10)) } };
};

export const createGroup = async (tenantId, userId, name) => {
  const existing = await ContactGroup.findOne({ name, tenantId });
  if (existing) throw new AppError('Group with this name already exists', 409);

  return ContactGroup.create({ name, tenantId, userId });
};

export const getGroupById = async (tenantId, id) => {
  const group = await ContactGroup.aggregate([
    { $match: { _id: id, tenantId: tenantId } },
    {
      $lookup: {
        from: 'contacts',
        localField: '_id',
        foreignField: 'groupId',
        as: 'contacts',
      },
    },
    { $addFields: { count: { $size: '$contacts' } } },
  ]);

  if (!group.length) throw new AppError('Group not found', 404);
  return { ...group[0], count: group[0].count };
};

export const updateGroup = async (tenantId, id, name) => {
  const existing = await ContactGroup.findOne({ name, tenantId, _id: { $ne: id } });
  if (existing) throw new AppError('Group with this name already exists', 409);

  return ContactGroup.findByIdAndUpdate(id, { name, updatedAt: new Date() }, { new: true });
};

export const deleteGroup = async (tenantId, id) => {
  await ContactGroup.findByIdAndDelete(id);
  return { success: true };
};

export async function listTags(tenantId) {
  return Contact.distinct('tags', { tenantId });
}
