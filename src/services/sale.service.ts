import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { PaginationQuery, Role, SaleStatus, PaymentMethod } from '../types';

interface SaleItemInput {
  productId: string;
  quantity: number;
}

interface CreateSaleInput {
  items: SaleItemInput[];
  paymentMethod: PaymentMethod;
  discount?: number;
  taxRate?: number;
  notes?: string;
  storeId: string;
  cashierId: string;
}

export class SaleService {
  async getAll(
    query: PaginationQuery & { status?: string; from?: string; to?: string },
    requesterRole: Role,
    requesterStoreId?: string | null,
    requesterId?: string
  ) {
    const page = parseInt(query.page ?? '1');
    const limit = parseInt(query.limit ?? '20');
    const skip = (page - 1) * limit;

    const where = {
      ...(query.status && { status: query.status as SaleStatus }),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from && { gte: new Date(query.from) }),
              ...(query.to && { lte: new Date(query.to) }),
            },
          }
        : {}),
      ...(requesterRole === 'CASHIER' && { cashierId: requesterId }),
      ...(requesterRole !== 'ADMIN' && requesterStoreId ? { storeId: requesterStoreId } : {}),
    };

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          cashier: { select: { id: true, name: true } },
          store: { select: { id: true, name: true } },
          items: {
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
        },
      }),
      prisma.sale.count({ where }),
    ]);

    return { data: sales, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(id: string, requesterRole: Role, requesterStoreId?: string | null) {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        store: { select: { id: true, name: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, price: true } } },
        },
      },
    });

    if (!sale) throw new AppError('Sale not found', 404);

    if (requesterRole !== 'ADMIN' && sale.storeId !== requesterStoreId) {
      throw new AppError('Forbidden', 403);
    }

    return sale;
  }

  async create(input: CreateSaleInput) {
    if (input.items.length === 0) throw new AppError('Sale must have at least one item', 400);

    // Validate all products exist and have enough stock
    const productIds = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true, storeId: input.storeId },
    });

    if (products.length !== productIds.length) {
      throw new AppError('One or more products not found in this store', 404);
    }

    // Check stock
    for (const item of input.items) {
      const product = products.find((p) => p.id === item.productId)!;
      if (product.stock < item.quantity) {
        throw new AppError(`Insufficient stock for product: ${product.name}`, 400);
      }
    }

    const taxRate = input.taxRate ?? 0.08;
    const discount = input.discount ?? 0;

    // Calculate totals
    let subtotal = 0;
    const itemsData = input.items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!;
      const total = product.price * item.quantity;
      subtotal += total;
      return {
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
        total,
      };
    });

    const discountAmount = subtotal * (discount / 100);
    const taxableAmount = subtotal - discountAmount;
    const tax = taxableAmount * taxRate;
    const total = taxableAmount + tax;

    const receiptNumber = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Use transaction: create sale + deduct stock atomically
    const sale = await prisma.$transaction(async (tx) => {
      const newSale = await tx.sale.create({
        data: {
          receiptNumber,
          subtotal,
          discount: discountAmount,
          tax,
          total,
          status: 'COMPLETED' as SaleStatus,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          cashierId: input.cashierId,
          storeId: input.storeId,
          items: { create: itemsData },
        },
        include: {
          items: { include: { product: { select: { id: true, name: true } } } },
          cashier: { select: { id: true, name: true } },
          store: { select: { id: true, name: true } },
        },
      });

      // Deduct stock
      for (const item of input.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }

      return newSale;
    });

    return sale;
  }

  async getInvoice(id: string, requesterRole: Role, requesterStoreId?: string | null) {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        store: { select: { id: true, name: true, address: true, phone: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, category: true } },
          },
        },
      },
    });

    if (!sale) throw new AppError('Sale not found', 404);
    if (requesterRole !== 'ADMIN' && sale.storeId !== requesterStoreId) {
      throw new AppError('Insufficient permissions', 403);
    }

    return {
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      date: sale.createdAt,
      cashier: sale.cashier,
      store: sale.store,
      items: sale.items.map((item) => ({
        productId: item.productId,
        name: item.product.name,
        sku: item.product.sku,
        category: item.product.category,
        quantity: item.quantity,
        unitPrice: item.price,
        total: item.total,
      })),
      subtotal: sale.subtotal,
      discountAmount: sale.discount,
      taxAmount: sale.tax,
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      notes: sale.notes,
      status: sale.status,
    };
  }

  async updateStatus(id: string, status: SaleStatus, requesterRole: Role, requesterStoreId?: string | null) {
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) throw new AppError('Sale not found', 404);

    if (requesterRole !== 'ADMIN' && sale.storeId !== requesterStoreId) {
      throw new AppError('Forbidden', 403);
    }

    if (sale.status === 'REFUNDED') throw new AppError('Cannot modify a refunded sale', 400);

    // If refunding, restore stock
    if (status === 'REFUNDED') {
      const items = await prisma.saleItem.findMany({ where: { saleId: id } });
      await prisma.$transaction([
        prisma.sale.update({ where: { id }, data: { status } }),
        ...items.map((item) =>
          prisma.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          })
        ),
      ]);
      return prisma.sale.findUnique({ where: { id } });
    }

    return prisma.sale.update({ where: { id }, data: { status } });
  }
}

export const saleService = new SaleService();
