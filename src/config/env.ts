import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Access token — short-lived (15m–1d)
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for security'),

  // Refresh token — separate secret so a compromise of one doesn't affect the other
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters for security')
    .optional()
    .transform((val) => val ?? (process.env.JWT_SECRET + '_refresh')), // safe fallback for dev

  JWT_EXPIRES_IN: z.string().default('1d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  // Gemini API keys — set at least one. Set all three to triple your effective RPM quota.
  // Keys rotate round-robin; if one returns RESOURCE_EXHAUSTED, the next is tried automatically.
  GEMINI_API_KEY:   z.string().optional(),  // original / single-key fallback
  GEMINI_API_KEY_1: z.string().optional(),  // second project key
  GEMINI_API_KEY_2: z.string().optional(),  // third project key

  // gemini-2.0-flash: faster, same free quota, better quality than 1.5-flash
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ Invalid or missing environment variables:\n');
  const errors = parsed.error.flatten().fieldErrors;
  Object.entries(errors).forEach(([field, messages]) => {
    console.error(`  ${field}: ${messages?.join(', ')}`);
  });
  console.error('\nCopy backend/.env.example to backend/.env and fill in the values.\n');
  process.exit(1);
}

export const env = parsed.data as typeof parsed.data & { JWT_REFRESH_SECRET: string };
