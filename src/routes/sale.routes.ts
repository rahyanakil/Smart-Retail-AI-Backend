import { Router } from 'express';
import {
  getSales,
  getSaleById,
  getSaleInvoice,
  createSale,
  updateSaleStatus,
} from '../controllers/sale.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/role.middleware';

const router = Router();

router.use(authenticate);

router.get('/', getSales);
router.post('/', authorize('ADMIN', 'OWNER', 'CASHIER'), createSale);
router.get('/:id', getSaleById);
router.get('/:id/invoice', getSaleInvoice);
router.patch('/:id/status', authorize('ADMIN', 'OWNER'), updateSaleStatus);

export default router;
