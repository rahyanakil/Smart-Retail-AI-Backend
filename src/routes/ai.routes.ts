import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { requireOwnerOrAbove } from '../middleware/role.middleware';
import {
  getStatus,
  getSalesForecast,
  getBusinessInsights,
  getRestockRecs,
  getCustomerBehavior,
} from '../controllers/ai.controller';

const router = Router();

// Stricter rate limit for AI endpoints — Gemini free tier has per-minute limits
const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 8,                // 8 AI requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'AI request limit reached. Please wait a moment before generating new insights.',
    code: 'AI_RATE_LIMITED',
  },
});

router.use(authenticate, requireOwnerOrAbove, aiRateLimit);

router.get('/status', getStatus);
router.get('/forecast', getSalesForecast);
router.get('/insights', getBusinessInsights);
router.get('/restock', getRestockRecs);
router.get('/behavior', getCustomerBehavior);

export default router;
