import { Router } from 'express';
import {
  listContactsController,
  createContactController,
  getContactController,
  updateContactController,
  deleteContactController,
  bulkDeleteContactsController,
  bulkImportContactsController,
  listGroupsController,
  createGroupController,
  getGroupController,
  updateGroupController,
  deleteGroupController,
} from '../controllers/contacts.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createContactSchema,
  updateContactSchema,
  contactIdParam,
  listContactsSchema,
  bulkDeleteContactsSchema,
  createGroupSchema,
  updateGroupSchema,
  groupIdParam,
  listGroupsSchema,
} from '../validators/contacts.js';

const router = Router();
router.use(authenticate);

router.get('/', validate(listContactsSchema), listContactsController);
router.post('/', validate(createContactSchema), createContactController);
router.post('/bulk-import', bulkImportContactsController);
router.post('/bulk-delete', validate(bulkDeleteContactsSchema), bulkDeleteContactsController);

router.get('/groups', validate(listGroupsSchema), listGroupsController);
router.post('/groups', validate(createGroupSchema), createGroupController);

router.get('/:id', validate(contactIdParam), getContactController);
router.put('/:id', validate(updateContactSchema), updateContactController);
router.delete('/:id', validate(contactIdParam), deleteContactController);

router.get('/groups/:id', validate(groupIdParam), getGroupController);
router.put('/groups/:id', validate(updateGroupSchema), updateGroupController);
router.delete('/groups/:id', validate(groupIdParam), deleteGroupController);

export default router;