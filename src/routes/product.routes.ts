import { Router } from 'express';
import {
  getPublicProducts,
  getPublicProductById,
  getProducts,
  getInventoryStats,
  getProductCategories,
  getProductById,
  createProduct,
  updateProduct,
  adjustStock,
  getStockLogs,
  deleteProduct,
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authorize } from '../middleware/role.middleware';

const router = Router();

// ── Public routes (no auth) ────────────────────────────────────────────────────
router.get('/public', getPublicProducts);
router.get('/public/:id', getPublicProductById);

router.use(authenticate);

// ── Collection routes ──────────────────────────────────────────────────────────
router.get('/', getProducts);
router.get('/stats', getInventoryStats);                          // inventory summary
router.get('/categories', getProductCategories);                  // unique category list
router.post('/', authorize('ADMIN', 'OWNER'), createProduct);

// ── Single-resource routes ─────────────────────────────────────────────────────
router.get('/:id', getProductById);
router.put('/:id', authorize('ADMIN', 'OWNER'), updateProduct);
router.patch('/:id/stock', authorize('ADMIN', 'OWNER'), adjustStock);
router.get('/:id/stock-logs', authorize('ADMIN', 'OWNER'), getStockLogs);
router.delete('/:id', authorize('ADMIN', 'OWNER'), deleteProduct);

export default router;
