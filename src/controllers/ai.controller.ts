import { Response } from 'express';
import { asyncHandler } from '../middleware/error.middleware';
import { AuthRequest } from '../types';
import {
  forecastSales,
  generateBusinessInsights,
  getRestockRecommendations,
  analyzeCustomerBehavior,
  getAiStatus,
} from '../services/ai.service';

export const getStatus = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const status = getAiStatus();
  res.json({ success: true, data: status });
});

export const getSalesForecast = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const data = await forecastSales(role, storeId);
  res.json({ success: true, data });
});

export const getBusinessInsights = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const data = await generateBusinessInsights(role, storeId);
  res.json({ success: true, data });
});

export const getRestockRecs = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const data = await getRestockRecommendations(role, storeId);
  res.json({ success: true, data });
});

export const getCustomerBehavior = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const data = await analyzeCustomerBehavior(role, storeId);
  res.json({ success: true, data });
});
