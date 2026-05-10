import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireOwnerOrAbove } from '../middleware/role.middleware';
import { cache } from '../lib/cache';
import {
  getStatus,
  getSalesForecast,
  getBusinessInsights,
  getRestockRecs,
  getCustomerBehavior,
} from '../controllers/ai.controller';
import type { AuthRequest } from '../types';

const router = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────
router.use(authenticate, requireOwnerOrAbove);

// ── Cache-bypass middleware ───────────────────────────────────────────────────
// Returns a warm cache entry immediately — no Gemini call, no quota consumed.
// This is the only rate-limiting mechanism needed: the backend serves cached
// results for 15 minutes and the Gemini SDK itself enforces its own per-minute
// quota with a 429 that we surface as a clean error to the client.
// A custom per-minute counter on top is counter-productive in dev (nodemon
// restarts wipe the in-memory cache, making every restart look like quota usage).
function withCache(operation: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { role, storeId } = (req as AuthRequest).user!;
    const key = `ai:${operation}:${role}:${storeId ?? 'admin'}`;
    const hit = cache.get(key);
    if (hit) {
      res.json({ success: true, data: hit, cached: true });
      return;
    }
    next();
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get('/status',   getStatus);
router.get('/forecast', withCache('forecast'), getSalesForecast);
router.get('/insights', withCache('insights'), getBusinessInsights);
router.get('/restock',  withCache('restock'),  getRestockRecs);
router.get('/behavior', withCache('behavior'), getCustomerBehavior);

export default router;
