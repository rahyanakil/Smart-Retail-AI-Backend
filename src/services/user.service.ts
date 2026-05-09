import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { PaginationQuery, Role } from '../types';

interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
  storeId?: string;
}

interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: Role;
  storeId?: string | null;
  isActive?: boolean;
}

export class UserService {
  async getAll(query: PaginationQuery, requesterRole: Role, requesterStoreId?: string | null) {
    const page = parseInt(query.page ?? '1');
    const limit = parseInt(query.limit ?? '20');
    const skip = (page - 1) * limit;

    const where = {
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' as const } },
          { email: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
      // Non-admins can only see users in their own store
      ...(requesterRole !== 'ADMIN' && { storeId: requesterStoreId }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          storeId: true,
          createdAt: true,
          store: { select: { id: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { data: users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(id: string, requesterRole: Role, requesterStoreId?: string | null) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        storeId: true,
        createdAt: true,
        updatedAt: true,
        store: { select: { id: true, name: true, address: true } },
      },
    });

    if (!user) throw new AppError('User not found', 404);

    if (requesterRole !== 'ADMIN' && user.storeId !== requesterStoreId) {
      throw new AppError('Forbidden', 403);
    }

    return user;
  }

  async create(input: CreateUserInput, creatorRole: Role) {
    // Only admins can create admins/owners without a store
    if (input.role === 'ADMIN' && creatorRole !== 'ADMIN') {
      throw new AppError('Only admins can create admin accounts', 403);
    }

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AppError('Email already in use', 409);

    if (input.storeId) {
      const store = await prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store) throw new AppError('Store not found', 404);
    }

    const hashedPassword = await bcrypt.hash(input.password, 12);

    return prisma.user.create({
      data: {
        ...input,
        password: hashedPassword,
        storeId: input.storeId ?? null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        storeId: true,
        createdAt: true,
      },
    });
  }

  async update(id: string, input: UpdateUserInput, requesterRole: Role, requesterStoreId?: string | null) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);

    if (requesterRole !== 'ADMIN' && user.storeId !== requesterStoreId) {
      throw new AppError('Forbidden', 403);
    }

    if (input.email && input.email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) throw new AppError('Email already in use', 409);
    }

    return prisma.user.update({
      where: { id },
      data: input,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        storeId: true,
        updatedAt: true,
      },
    });
  }

  async delete(id: string, requesterId: string) {
    if (id === requesterId) throw new AppError('Cannot delete your own account', 400);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);

    await prisma.user.delete({ where: { id } });
  }
}

export const userService = new UserService();
