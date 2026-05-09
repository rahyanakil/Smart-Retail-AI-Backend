import { prisma } from '../lib/prisma';
import { Role, SaleStatus } from '../types';

export class AnalyticsService {
  async getDashboard(requesterRole: Role, storeId?: string | null) {
    const storeFilter = requesterRole !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const completedFilter = { status: 'COMPLETED' as SaleStatus };

    const [
      totalRevenue,
      revenueThisMonth,
      revenueLastMonth,
      salesToday,
      salesThisMonth,
      totalProducts,
      lowStockProducts,
      totalUsers,
      totalStores,
      recentSales,
    ] = await Promise.all([
      // Total all-time revenue
      prisma.sale.aggregate({
        where: { ...storeFilter, ...completedFilter },
        _sum: { total: true },
      }),
      // This month revenue
      prisma.sale.aggregate({
        where: { ...storeFilter, ...completedFilter, createdAt: { gte: startOfMonth } },
        _sum: { total: true },
        _count: true,
      }),
      // Last month revenue
      prisma.sale.aggregate({
        where: {
          ...storeFilter,
          ...completedFilter,
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
        },
        _sum: { total: true },
        _count: true,
      }),
      // Today's sales
      prisma.sale.aggregate({
        where: { ...storeFilter, ...completedFilter, createdAt: { gte: startOfToday } },
        _sum: { total: true },
        _count: true,
      }),
      // This month sales count
      prisma.sale.count({
        where: { ...storeFilter, ...completedFilter, createdAt: { gte: startOfMonth } },
      }),
      // Total active products
      prisma.product.count({ where: { ...storeFilter, isActive: true } }),
      // Low stock products (raw query for comparing to self column)
      prisma.product.findMany({
        where: { ...storeFilter, isActive: true },
        select: { id: true, name: true, sku: true, stock: true, lowStockAlert: true },
      }),
      // Total users (admin only)
      requesterRole === 'ADMIN' ? prisma.user.count({ where: { isActive: true } }) : Promise.resolve(null),
      // Total stores (admin only)
      requesterRole === 'ADMIN' ? prisma.store.count({ where: { isActive: true } }) : Promise.resolve(null),
      // Recent sales
      prisma.sale.findMany({
        where: { ...storeFilter, ...completedFilter },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          cashier: { select: { name: true } },
          store: { select: { name: true } },
          items: { include: { product: { select: { name: true } } } },
        },
      }),
    ]);

    const lowStock = lowStockProducts.filter((p) => p.stock <= p.lowStockAlert);

    const totalRev = totalRevenue._sum?.total ?? 0;
    const thisMonthRev = revenueThisMonth._sum?.total ?? 0;
    const lastMonthRev = revenueLastMonth._sum?.total ?? 0;
    const todayRev = salesToday._sum?.total ?? 0;

    const revenueGrowth =
      lastMonthRev > 0 ? ((thisMonthRev - lastMonthRev) / lastMonthRev) * 100 : 0;

    return {
      revenue: {
        total: totalRev,
        thisMonth: thisMonthRev,
        lastMonth: lastMonthRev,
        growthPercent: Math.round(revenueGrowth * 100) / 100,
      },
      sales: {
        today: salesToday._count,
        todayRevenue: todayRev,
        thisMonth: salesThisMonth,
        lastMonth: revenueLastMonth._count,
      },
      inventory: {
        totalProducts,
        lowStockCount: lowStock.length,
        lowStockItems: lowStock.slice(0, 10),
      },
      ...(requesterRole === 'ADMIN' && { users: totalUsers, stores: totalStores }),
      recentSales,
    };
  }

  async getSalesChart(
    period: 'daily' | 'weekly' | 'monthly',
    requesterRole: Role,
    storeId?: string | null
  ) {
    const storeFilter = requesterRole !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};
    const now = new Date();
    let startDate: Date;
    let groupFormat: string;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        groupFormat = 'day';
        break;
      case 'weekly':
        startDate = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
        groupFormat = 'week';
        break;
      case 'monthly':
      default:
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        groupFormat = 'month';
    }

    const sales = await prisma.sale.findMany({
      where: {
        ...storeFilter,
        status: 'COMPLETED',
        createdAt: { gte: startDate },
      },
      select: { total: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by period
    const grouped: Record<string, { revenue: number; count: number }> = {};

    for (const sale of sales) {
      let key: string;
      const d = new Date(sale.createdAt);

      if (groupFormat === 'day') {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      } else if (groupFormat === 'week') {
        const weekNum = Math.ceil(d.getDate() / 7);
        key = `${d.getFullYear()}-W${weekNum}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }

      if (!grouped[key]) grouped[key] = { revenue: 0, count: 0 };
      grouped[key].revenue += sale.total;
      grouped[key].count += 1;
    }

    return Object.entries(grouped).map(([date, data]) => ({
      date,
      revenue: Math.round(data.revenue * 100) / 100,
      count: data.count,
    }));
  }

  async getTopProducts(
    limit = 10,
    requesterRole: Role,
    storeId?: string | null
  ) {
    const storeFilter = requesterRole !== 'ADMIN' ? { sale: { storeId: storeId ?? undefined } } : {};

    const topItems = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'COMPLETED', ...('sale' in storeFilter ? storeFilter.sale : {}) } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: limit,
    });

    const productIds = topItems.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, category: true, price: true },
    });

    return topItems.map((item) => ({
      product: products.find((p) => p.id === item.productId),
      totalQuantity: item._sum.quantity ?? 0,
      totalRevenue: item._sum.total ?? 0,
    }));
  }
}

export const analyticsService = new AnalyticsService();
