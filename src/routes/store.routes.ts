import { Router } from 'express';
import {
  getStores,
  getStoreById,
  createStore,
  updateStore,
  deleteStore,
} from '../controllers/store.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin, requireOwnerOrAbove } from '../middleware/role.middleware';

const router = Router();

router.use(authenticate);

router.get('/', getStores);
router.get('/:id', requireOwnerOrAbove, getStoreById);
router.post('/', requireAdmin, createStore);
router.put('/:id', requireAdmin, updateStore);
router.delete('/:id', requireAdmin, deleteStore);

export default router;
