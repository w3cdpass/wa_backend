import { Router } from 'express';
import {
  listVariablesController,
  createVariableController,
  updateVariableController,
  deleteVariableController,
} from '../controllers/variables.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createVariableSchema,
  updateVariableSchema,
  variableIdParam,
} from '../validators/variables.js';

const router = Router();

router.use(authenticate);

router.get('/', listVariablesController);
router.post('/', validate(createVariableSchema), createVariableController);
router.put('/:id', validate(updateVariableSchema), updateVariableController);
router.delete('/:id', validate(variableIdParam), deleteVariableController);

export default router;
