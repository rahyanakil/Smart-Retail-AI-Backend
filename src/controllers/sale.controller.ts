import { Request, Response } from 'express';
import { z } from 'zod';
import { saleService } from '../services/sale.service';
import type { SaleStatus, PaymentMethod } from '../types';
import { asyncHandler } from '../middleware/error.middleware';

const createSaleSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  paymentMethod: z.enum(['CASH', 'CARD', 'DIGITAL_WALLET']),
  discount: z.number().min(0).max(100).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
  storeId: z.string(),
});

const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED']),
});

export const getSales = asyncHandler(async (req: Request, res: Response) => {
  const result = await saleService.getAll(
    req.query as any,
    req.user!.role,
    req.user!.storeId,
    req.user!.userId
  );
  res.status(200).json({ success: true, data: result });
});

export const getSaleById = asyncHandler(async (req: Request, res: Response) => {
  const sale = await saleService.getById(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: sale });
});

export const createSale = asyncHandler(async (req: Request, res: Response) => {
  const body = createSaleSchema.parse(req.body);
  const sale = await saleService.create({ ...body, cashierId: req.user!.userId });
  res.status(201).json({ success: true, message: 'Sale created', data: sale });
});

export const getSaleInvoice = asyncHandler(async (req: Request, res: Response) => {
  const invoice = await saleService.getInvoice(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: invoice });
});

export const updateSaleStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = updateStatusSchema.parse(req.body);
  const sale = await saleService.updateStatus(req.params.id, status, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, message: 'Sale status updated', data: sale });
});
