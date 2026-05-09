import { Request, Response } from 'express';
import { z } from 'zod';
import { analyticsService } from '../services/analytics.service';
import { asyncHandler } from '../middleware/error.middleware';

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const data = await analyticsService.getDashboard(req.user!.role, req.user!.storeId);
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
