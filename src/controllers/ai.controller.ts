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
import { cache, TTL } from '../lib/cache';

// AI calls are expensive — cache per store for 15 minutes, matching the
// frontend's TanStack Query staleTime so re-fetches always get fresh data.

function aiKey(operation: string, role: string, storeId: string | null | undefined) {
  return `ai:${operation}:${role}:${storeId ?? 'admin'}`;
}

export const getStatus = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const status = getAiStatus();
  res.json({ success: true, data: status });
});

export const getSalesForecast = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const key = aiKey('forecast', role, storeId);
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, data: cached, cached: true });
  const data = await forecastSales(role, storeId);
  cache.set(key, data, TTL.FIFTEEN_MIN);
  res.json({ success: true, data });
});

export const getBusinessInsights = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const key = aiKey('insights', role, storeId);
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, data: cached, cached: true });
  const data = await generateBusinessInsights(role, storeId);
  cache.set(key, data, TTL.FIFTEEN_MIN);
  res.json({ success: true, data });
});

export const getRestockRecs = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const key = aiKey('restock', role, storeId);
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, data: cached, cached: true });
  const data = await getRestockRecommendations(role, storeId);
  cache.set(key, data, TTL.FIFTEEN_MIN);
  res.json({ success: true, data });
});

export const getCustomerBehavior = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role, storeId } = req.user!;
  const key = aiKey('behavior', role, storeId);
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, data: cached, cached: true });
  const data = await analyzeCustomerBehavior(role, storeId);
  cache.set(key, data, TTL.FIFTEEN_MIN);
  res.json({ success: true, data });
});
