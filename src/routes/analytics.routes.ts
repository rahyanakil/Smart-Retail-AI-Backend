import { Router } from 'express';
import { getDashboard, getSalesChart, getTopProducts } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/dashboard', getDashboard);
router.get('/sales-chart', getSalesChart);
router.get('/top-products', getTopProducts);

export default router;
