import { Request } from 'express';

export type Role = 'ADMIN' | 'OWNER' | 'CASHIER';
export type SaleStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
export type PaymentMethod = 'CASH' | 'CARD' | 'DIGITAL_WALLET';

export interface JWTPayload {
  userId: string;
  email: string;
  role: Role;
  storeId?: string | null;
  name: string;
}

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export {};

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}
