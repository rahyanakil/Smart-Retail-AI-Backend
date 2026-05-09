import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import type { PaginationQuery, Role } from '../types';

// ─── Input types ──────────────────────────────────────────────────────────────

interface ProductInput {
  name: string;
  description?: string;
  price: number;
  costPrice?: number;
  stock?: number;
  lowStockAlert?: number;
  sku: string;
  barcode?: string;
  category?: string;
  imageUrl?: string;
  storeId: string;
}

type ProductUpdateInput = Partial<Omit<ProductInput, 'sku' | 'storeId'>>;

interface StockAdjustInput {
  /** Relative change (positive = add, negative = remove). Mutually exclusive with setTo. */
  adjustment?: number;
  /** Set stock to this exact value. Mutually exclusive with adjustment. */
  setTo?: number;
  reason?: string;
}

// ─── Scope helper ─────────────────────────────────────────────────────────────

function storeScope(role: Role, storeId?: string | null): Prisma.ProductWhereInput {
  return role !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ProductService {
  // ── List ────────────────────────────────────────────────────────────────────

  async getAll(
    query: PaginationQuery & { category?: string; status?: 'low_stock' | 'out_of_stock' | 'in_stock' },
    role: Role,
    storeId?: string | null
  ) {
    const page = Math.max(1, parseInt(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20')));
    const skip = (page - 1) * limit;

    const searchClause: Prisma.ProductWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { sku: { contains: query.search, mode: 'insensitive' } },
            { barcode: { contains: query.search, mode: 'insensitive' } },
            { category: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...storeScope(role, storeId),
      ...searchClause,
      ...(query.category && { category: { equals: query.category, mode: 'insensitive' } }),
    };

    const orderField = ['name', 'price', 'stock', 'costPrice', 'createdAt', 'updatedAt'].includes(
      query.sortBy ?? ''
    )
      ? query.sortBy!
      : 'createdAt';

    // When a stock-status filter is requested we must compare two columns (stock vs
    // lowStockAlert), which Prisma's regular API cannot express. Fetch all matching
    // rows, filter in JS, then slice for the page. For typical store catalogs
    // (< 1,000 products) this is fast enough and keeps the pagination totals correct.
    if (query.status && query.status !== ('all' as string)) {
      const all = await prisma.product.findMany({
        where,
        orderBy: { [orderField]: query.sortOrder ?? 'desc' },
        include: { store: { select: { id: true, name: true } } },
      });

      let filtered = all;
      if (query.status === 'out_of_stock') filtered = all.filter((p) => p.stock === 0);
      else if (query.status === 'low_stock') filtered = all.filter((p) => p.stock > 0 && p.stock <= p.lowStockAlert);
      else if (query.status === 'in_stock') filtered = all.filter((p) => p.stock > p.lowStockAlert);

      const filteredTotal = filtered.length;
      return {
        data: filtered.slice(skip, skip + limit),
        total: filteredTotal,
        page,
        limit,
        totalPages: Math.ceil(filteredTotal / limit),
      };
    }

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [orderField]: query.sortOrder ?? 'desc' },
        include: { store: { select: { id: true, name: true } } },
      }),
      prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ── Inventory stats ──────────────────────────────────────────────────────────

  async getStats(role: Role, storeId?: string | null) {
    const where: Prisma.ProductWhereInput = { isActive: true, ...storeScope(role, storeId) };

    const products = await prisma.product.findMany({
      where,
      select: { stock: true, lowStockAlert: true, price: true, costPrice: true, category: true },
    });

    const total = products.length;
    const outOfStock = products.filter((p) => p.stock === 0).length;
    const lowStock = products.filter((p) => p.stock > 0 && p.stock <= p.lowStockAlert).length;
    const inStock = total - outOfStock - lowStock;
    const inventoryValue = products.reduce((s, p) => s + p.stock * p.costPrice, 0);
    const retailValue = products.reduce((s, p) => s + p.stock * p.price, 0);

    // Category breakdown (excluding null)
    const catMap: Record<string, number> = {};
    for (const p of products) {
      if (p.category) catMap[p.category] = (catMap[p.category] ?? 0) + 1;
    }
    const categories = Object.entries(catMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalProducts: total,
      inStock,
      lowStock,
      outOfStock,
      inventoryValue: Math.round(inventoryValue * 100) / 100,
      retailValue: Math.round(retailValue * 100) / 100,
      potentialProfit: Math.round((retailValue - inventoryValue) * 100) / 100,
      categoriesCount: categories.length,
      categories,
    };
  }

  // ── Categories ───────────────────────────────────────────────────────────────

  async getCategories(role: Role, storeId?: string | null) {
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      NOT: { category: null },
      ...storeScope(role, storeId),
    };

    const result = await prisma.product.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
    });

    return result
      .filter((r) => r.category !== null)
      .map((r) => ({ name: r.category as string, count: r._count._all }));
  }

  // ── Single product ───────────────────────────────────────────────────────────

  async getById(id: string, role: Role, storeId?: string | null) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { store: { select: { id: true, name: true } } },
    });

    if (!product || !product.isActive) throw new AppError('Product not found', 404);
    if (role !== 'ADMIN' && product.storeId !== storeId) throw new AppError('Insufficient permissions', 403);

    return product;
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  async create(input: ProductInput, role: Role, storeId?: string | null) {
    if (role !== 'ADMIN' && input.storeId !== storeId) {
      throw new AppError('Cannot create products for another store', 403);
    }

    const store = await prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store) throw new AppError('Store not found', 404);

    const existing = await prisma.product.findUnique({ where: { sku: input.sku } });
    if (existing) throw new AppError(`SKU "${input.sku}" is already in use`, 409);

    return prisma.product.create({
      data: {
        ...input,
        costPrice: input.costPrice ?? 0,
        stock: input.stock ?? 0,
        lowStockAlert: input.lowStockAlert ?? 10,
      },
    });
  }

  async update(id: string, input: ProductUpdateInput, role: Role, storeId?: string | null) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || !product.isActive) throw new AppError('Product not found', 404);
    if (role !== 'ADMIN' && product.storeId !== storeId) throw new AppError('Insufficient permissions', 403);

    return prisma.product.update({ where: { id }, data: input });
  }

  async delete(id: string, role: Role, storeId?: string | null) {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new AppError('Product not found', 404);
    if (role !== 'ADMIN' && product.storeId !== storeId) throw new AppError('Insufficient permissions', 403);

    return prisma.product.update({ where: { id }, data: { isActive: false } });
  }

  // ── Stock adjustment (with audit log) ─────────────────────────────────────────

  async adjustStock(
    id: string,
    params: StockAdjustInput,
    role: Role,
    storeId?: string | null,
    userId?: string
  ) {
    return prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id } });
      if (!product || !product.isActive) throw new AppError('Product not found', 404);
      if (role !== 'ADMIN' && product.storeId !== storeId) throw new AppError('Insufficient permissions', 403);

      const before = product.stock;
      let after: number;
      let adjustmentType: string;

      if (params.setTo !== undefined) {
        if (params.setTo < 0) throw new AppError('Stock cannot be negative', 400);
        after = params.setTo;
        adjustmentType = 'SET';
      } else {
        const delta = params.adjustment ?? 0;
        after = before + delta;
        if (after < 0) throw new AppError(`Insufficient stock (current: ${before})`, 400);
        adjustmentType = delta >= 0 ? 'ADD' : 'REMOVE';
      }

      const [updated] = await Promise.all([
        tx.product.update({ where: { id }, data: { stock: after } }),
        userId
          ? tx.stockLog.create({
              data: {
                productId: id,
                userId,
                adjustmentType,
                quantityBefore: before,
                quantityAfter: after,
                reason: params.reason,
              },
            })
          : Promise.resolve(null),
      ]);

      return updated;
    });
  }

  // ── Stock audit log ──────────────────────────────────────────────────────────

  async getStockLogs(productId: string, role: Role, storeId?: string | null) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) throw new AppError('Product not found', 404);
    if (role !== 'ADMIN' && product.storeId !== storeId) throw new AppError('Insufficient permissions', 403);

    return prisma.stockLog.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { user: { select: { id: true, name: true } } },
    });
  }

  // ── Low-stock (raw — compares two columns) ────────────────────────────────────

  async getLowStock(storeId: string) {
    return prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        sku: string;
        stock: number;
        lowStockAlert: number;
        category: string | null;
      }>
    >`
      SELECT id, name, sku, stock, "lowStockAlert", category
      FROM   "Product"
      WHERE  "storeId"  = ${storeId}
        AND  "isActive" = true
        AND  stock      <= "lowStockAlert"
      ORDER BY stock ASC
    `;
  }
}

export const productService = new ProductService();
