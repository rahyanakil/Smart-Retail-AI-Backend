import { Router, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { streamChat } from '../controllers/chat.controller';

const router = Router();

// Chat gets a more generous rate limit than batch AI — 20 messages/min per IP
const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many chat messages. Please slow down.',
    code: 'CHAT_RATE_LIMITED',
  },
});

// All authenticated roles can use the copilot
router.post('/stream', authenticate, chatRateLimit, streamChat as RequestHandler);

export default router;
