import { Request, Response } from 'express';
import { z } from 'zod';
import { storeService } from '../services/store.service';
import { asyncHandler } from '../middleware/error.middleware';

const storeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).trim(),
  address: z.string().max(500).trim().optional(),
  phone: z.string().max(30).trim().optional(),
});

export const getStores = asyncHandler(async (req: Request, res: Response) => {
  const data = await storeService.getAll(req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data });
});

export const getStoreById = asyncHandler(async (req: Request, res: Response) => {
  const store = await storeService.getById(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: store });
});

export const createStore = asyncHandler(async (req: Request, res: Response) => {
  const body = storeSchema.parse(req.body);
  const store = await storeService.create(body);
  res.status(201).json({ success: true, message: 'Store created', data: store });
});

export const updateStore = asyncHandler(async (req: Request, res: Response) => {
  const body = storeSchema.partial().parse(req.body);
  const store = await storeService.update(req.params.id, body);
  res.status(200).json({ success: true, message: 'Store updated', data: store });
});

export const deleteStore = asyncHandler(async (req: Request, res: Response) => {
  await storeService.delete(req.params.id);
  res.status(200).json({ success: true, message: 'Store deleted' });
});
