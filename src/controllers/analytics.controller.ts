import { Request, Response } from 'express';
import { z } from 'zod';
import { analyticsService } from '../services/analytics.service';
import { asyncHandler } from '../middleware/error.middleware';
import { cache, TTL } from '../lib/cache';

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const { role, storeId } = req.user!;
  const key = `analytics:dashboard:${role}:${storeId ?? 'admin'}`;
  const cached = cache.get(key);
  if (cached) return res.status(200).json({ success: true, data: cached, cached: true });
  const data = await analyticsService.getDashboard(role, storeId);
  cache.set(key, data, TTL.ONE_MINUTE);
  res.status(200).json({ success: true, data });
});

export const getSalesChart = asyncHandler(async (req: Request, res: Response) => {
  const { period } = z
    .object({ period: z.enum(['daily', 'weekly', 'monthly']).default('daily') })
    .parse(req.query);

  const data = await analyticsService.getSalesChart(period, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data });
});

export const getTopProducts = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = z.object({ limit: z.coerce.number().default(10) }).parse(req.query);
  const data = await analyticsService.getTopProducts(limit, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data });
});
