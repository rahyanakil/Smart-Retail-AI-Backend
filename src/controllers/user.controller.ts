import { Request, Response } from 'express';
import { z } from 'zod';
import { userService } from '../services/user.service';
import { asyncHandler } from '../middleware/error.middleware';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
  role: z.enum(['ADMIN', 'OWNER', 'CASHIER']),
  storeId: z.string().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ADMIN', 'OWNER', 'CASHIER']).optional(),
  storeId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.getAll(req.query as any, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: result });
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getById(req.params.id, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, data: user });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const body = createUserSchema.parse(req.body);
  const user = await userService.create(body, req.user!.role);
  res.status(201).json({ success: true, message: 'User created', data: user });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const body = updateUserSchema.parse(req.body);
  const user = await userService.update(req.params.id, body, req.user!.role, req.user!.storeId);
  res.status(200).json({ success: true, message: 'User updated', data: user });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await userService.delete(req.params.id, req.user!.userId);
  res.status(200).json({ success: true, message: 'User deleted' });
});
