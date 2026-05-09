import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

// ─── Rate limiters ────────────────────────────────────────────────────────────

/** Tight limit for mutating auth actions (register, login). */
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 15 minutes.',
    code: 'RATE_LIMITED',
  },
  skipSuccessfulRequests: false,
});

/** Looser limit for read/refresh actions. */
const normalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
    code: 'RATE_LIMITED',
  },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

const router = Router();

// Public
router.post('/register', strictLimiter, register);
router.post('/login', strictLimiter, login);
router.post('/refresh', normalLimiter, refresh);

// Authenticated
router.get('/me', normalLimiter, authenticate, getMe);
router.post('/logout', normalLimiter, authenticate, logout);
router.post('/logout-all', normalLimiter, authenticate, logoutAll);

export default router;
