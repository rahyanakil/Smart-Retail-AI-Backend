import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { authService } from '../services/auth.service';
import { asyncHandler, AppError } from '../middleware/error.middleware';

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Public registration always creates a CASHIER account.
 * Admins/owners assign roles through the users API after authentication.
 */
const registerSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100)
    .trim(),
  email: z
    .string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseZod<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const message = err.errors.map((e) => e.message).join(', ');
      throw new AppError(message, 400);
    }
    throw err;
  }
}

// ─── Controllers ─────────────────────────────────────────────────────────────

export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = parseZod(registerSchema, req.body);
  const result = await authService.register(body);

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    data: result,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = parseZod(loginSchema, req.body);
  const result = await authService.login(body);

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: result,
  });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = parseZod(refreshSchema, req.body);
  const tokens = await authService.refresh(refreshToken);

  res.status(200).json({
    success: true,
    data: tokens,
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = parseZod(logoutSchema, req.body);
  await authService.logout(refreshToken);

  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  await authService.logoutAll(req.user!.userId);
  res.status(200).json({ success: true, message: 'All sessions revoked' });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.user!.userId);
  res.status(200).json({ success: true, data: user });
});

const updateMeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).trim().optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .optional(),
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const body = parseZod(updateMeSchema, req.body);
  const user = await authService.updateMe(req.user!.userId, body);
  res.status(200).json({ success: true, data: user, message: 'Profile updated' });
});
