import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { logger } from './lib/logger';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler } from './middleware/error.middleware';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import productRoutes from './routes/product.routes';
import saleRoutes from './routes/sale.routes';
import analyticsRoutes from './routes/analytics.routes';
import storeRoutes from './routes/store.routes';
import aiRoutes from './routes/ai.routes';
import chatRoutes from './routes/chat.routes';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Dev:  any http://localhost:* or LAN IP is allowed automatically.
// Prod: only origins listed in FRONTEND_URL (comma-separated).

const allowedOrigins = env.FRONTEND_URL.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Postman / curl / server-to-server

      if (env.NODE_ENV === 'development') {
        const isLocal =
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
          /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
        if (isLocal) return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Security & body parsing ──────────────────────────────────────────────────

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP request logging — pipe Morgan output through Winston
app.use(
  morgan('combined', {
    stream: { write: (msg: string) => logger.http(msg.trim()) },
    skip: (_req, res) => res.statusCode < 400 && process.env.NODE_ENV === 'production',
  })
);

// ─── Global rate limit ────────────────────────────────────────────────────────

app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests. Please try again later.',
      code: 'RATE_LIMITED',
    },
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Root — show API info instead of 404 so developers know the server is up
app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'SmartRetail AI API',
    version: '1.0.0',
    status: 'online',
    database: 'Neon PostgreSQL',
    docs: {
      health: 'GET /health',
      auth: '/api/auth',
      users: '/api/users',
      products: '/api/products',
      sales: '/api/sales',
      analytics: '/api/analytics',
      stores: '/api/stores',
      ai: '/api/ai',
      chat: '/api/chat',
    },
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    database: 'Neon PostgreSQL',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/chat', chatRoutes);

// 404 for any unmatched API path
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    hint: 'All API routes start with /api/ — e.g. POST /api/auth/login',
  });
});

app.use(errorHandler);

// ─── Start (local dev only — Vercel imports the exported app instead) ─────────

if (!process.env.VERCEL) {
  const server = app.listen(env.PORT, () => {
    logger.info(`SmartRetail AI API → http://localhost:${env.PORT}`);
    logger.info(`Environment: ${env.NODE_ENV} | DB: Neon PostgreSQL`);
    logger.info(
      `CORS: ${env.NODE_ENV === 'development' ? 'any localhost:* (dev mode)' : allowedOrigins.join(', ')}`
    );
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use. Kill the process first.`);
    } else {
      logger.error('Server error', { error: err.message });
    }
    process.exit(1);
  });

  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

export default app;
