import { Router } from 'express';
import { getUsers, getUserById, createUser, updateUser, deleteUser } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/role.middleware';

const router = Router();

router.use(authenticate);

router.get('/', authorize('ADMIN', 'OWNER'), getUsers);
router.get('/:id', authorize('ADMIN', 'OWNER'), getUserById);
router.post('/', authorize('ADMIN', 'OWNER'), createUser);
router.put('/:id', authorize('ADMIN', 'OWNER'), updateUser);
router.delete('/:id', authorize('ADMIN'), deleteUser);

export default router;
