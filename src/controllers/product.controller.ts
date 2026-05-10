import { Request, Response } from 'express';
import { z } from 'zod';
import { productService } from '../services/product.service';
import { asyncHandler, AppError } from '../middleware/error.middleware';

// ─── Validation schemas ───────────────────────────────────────────────────────

const createProductSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(500).optional(),
  price: z.number().positive('Selling price must be positive'),
  costPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  lowStockAlert: z.number().int().min(0).optional(),
  sku: z.string().min(1).max(50).trim(),
  barcode: z.string().max(50).optional(),
  category: z.string().max(100).trim().optional(),
  imageUrl: z.string().url().optional(),
  storeId: z.string().min(1),
});

const updateProductSchema = createProductSchema
  .omit({ sku: true, storeId: true })
  .partial();

const adjustStockSchema = z.object({
  adjustment: z.number().int().optional(),
  setTo: z.number().int().min(0).optional(),
  reason: z.string().max(500).optional(),
}).refine(
  (d) => d.adjustment !== undefined || d.setTo !== undefined,
  { message: 'Provide either "adjustment" or "setTo"' }
);

// ─── Controllers ─────────────────────────────────────────────────────────────

export const getPublicProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await productService.getPublicProducts(req.query as any);
  res.status(200).json({ success: true, data: result });
});

export const getPublicProductById = asyncHandler(async (req: Request, res: Response) => {
  const result = await productService.getPublicProductById(req.params.id);
  res.status(200).json({ success: true, data: result });
});

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await productService.getAll(req.query as any, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: result });
});

export const getInventoryStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await productService.getStats(req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: stats });
});

export const getProductCategories = asyncHandler(async (req: Request, res: Response) => {
  const categories = await productService.getCategories(req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: categories });
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.getById(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: product });
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = createProductSchema.parse(req.body);
  const product = await productService.create(body, req.user!.role, req.user!.storeId);
  res.status(201).json({ success: true, message: 'Product created', data: product });
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = updateProductSchema.parse(req.body);
  const product = await productService.update(req.params.id, body, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, message: 'Product updated', data: product });
});

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {
  const body = adjustStockSchema.parse(req.body);
  const product = await productService.adjustStock(
    req.params.id,
    body,
    req.user!.role,
    req.user!.storeId,
    req.user!.userId
  );
  res.status(200).json({ success: true, message: 'Stock adjusted', data: product });
});

export const getStockLogs = asyncHandler(async (req: Request, res: Response) => {
  const logs = await productService.getStockLogs(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: logs });
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productService.delete(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, message: 'Product deleted' });
});
