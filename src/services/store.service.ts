import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import type { Role } from '../types';

interface StoreInput {
  name: string;
  address?: string;
  phone?: string;
}

export class StoreService {
  async getAll(role: Role, storeId?: string | null) {
    // Non-admin users can only see their own store
    if (role !== 'ADMIN') {
      if (!storeId) return { data: [], total: 0 };
      const store = await prisma.store.findUnique({
        where: { id: storeId, isActive: true },
        include: { _count: { select: { users: true, products: true, sales: true } } },
      });
      return { data: store ? [store] : [], total: store ? 1 : 0 };
    }

    const [data, total] = await Promise.all([
      prisma.store.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        include: { _count: { select: { users: true, products: true, sales: true } } },
      }),
      prisma.store.count({ where: { isActive: true } }),
    ]);

    return { data, total };
  }

  async getById(id: string, role: Role, storeId?: string | null) {
    if (role !== 'ADMIN' && storeId !== id) throw new AppError('Insufficient permissions', 403);

    const store = await prisma.store.findUnique({
      where: { id },
      include: { _count: { select: { users: true, products: true, sales: true } } },
    });
    if (!store || !store.isActive) throw new AppError('Store not found', 404);
    return store;
  }

  async create(input: StoreInput) {
    return prisma.store.create({
      data: {
        name: input.name,
        address: input.address,
        phone: input.phone,
      },
      include: { _count: { select: { users: true, products: true, sales: true } } },
    });
  }

  async update(id: string, input: Partial<StoreInput>) {
    const store = await prisma.store.findUnique({ where: { id } });
    if (!store || !store.isActive) throw new AppError('Store not found', 404);

    return prisma.store.update({
      where: { id },
      data: input,
      include: { _count: { select: { users: true, products: true, sales: true } } },
    });
  }

  async delete(id: string) {
    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) throw new AppError('Store not found', 404);

    return prisma.store.update({ where: { id }, data: { isActive: false } });
  }
}

export const storeService = new StoreService();
