import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import { keyRotator } from '../lib/keyRotator';
import { Role } from '../types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatHistoryItem {
  role: 'user' | 'model';
  content: string;
}

// ── Gemini client (uses rotating keys) ───────────────────────────────────────

function getGeminiClient(): GoogleGenerativeAI {
  if (keyRotator.count() === 0) {
    throw new AppError(
      'Gemini API key not configured. Add GEMINI_API_KEY to backend/.env',
      503
    );
  }
  // Chat uses the next key in rotation — same pool as batch AI calls
  return new GoogleGenerativeAI(keyRotator.next());
}

// ── Context builder ───────────────────────────────────────────────────────────

export async function buildChatContext(role: Role, storeId?: string | null): Promise<string> {
  const sf = role !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

  const [
    todayStats,
    monthStats,
    lastMonthStats,
    topProductItems,
    allProducts,
    recentSales,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: startOfToday } },
      _sum: { total: true, tax: true, discount: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
      _sum: { total: true },
      _count: true,
      _avg: { total: true },
    }),
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo }, ...sf } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    }),
    prisma.product.findMany({
      where: { ...sf, isActive: true },
      select: {
        id: true, name: true, sku: true, category: true,
        stock: true, lowStockAlert: true, price: true, costPrice: true,
      },
    }),
    prisma.sale.findMany({
      where: { ...sf, status: 'COMPLETED' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        receiptNumber: true, total: true, paymentMethod: true, createdAt: true,
        cashier: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  // Resolve product names for top items
  const productIds = topProductItems.map((i) => i.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, category: true },
      })
    : [];

  // Inventory metrics
  const lowStockList = allProducts.filter((p) => p.stock > 0 && p.stock <= p.lowStockAlert);
  const outOfStockList = allProducts.filter((p) => p.stock === 0);
  const totalCostValue = allProducts.reduce((s, p) => s + p.costPrice * p.stock, 0);
  const totalRetailValue = allProducts.reduce((s, p) => s + p.price * p.stock, 0);

  // Revenue
  const todayRev = todayStats._sum.total ?? 0;
  const todayTax = todayStats._sum.tax ?? 0;
  const todayDiscount = todayStats._sum.discount ?? 0;
  const monthRev = monthStats._sum.total ?? 0;
  const lastMonthRev = lastMonthStats._sum.total ?? 0;
  const avgOrder = monthStats._avg.total ?? 0;
  const monthGrowth = lastMonthRev > 0 ? ((monthRev - lastMonthRev) / lastMonthRev) * 100 : 0;

  // Top products lines
  const topLines = topProductItems.length
    ? topProductItems.map((item, i) => {
        const p = products.find((x) => x.id === item.productId);
        return `${i + 1}. ${p?.name ?? 'Unknown'} (${p?.category ?? 'N/A'}): $${(item._sum.total ?? 0).toFixed(2)} revenue, ${item._sum.quantity ?? 0} units`;
      }).join('\n')
    : 'No sales data yet';

  // Low stock lines
  const lowStockLines = lowStockList.length
    ? lowStockList.slice(0, 8).map((p) => `• ${p.name} (${p.sku}): ${p.stock} units left [alert: ≤${p.lowStockAlert}]`).join('\n')
    : 'None — all products well stocked';

  const outOfStockLines = outOfStockList.length
    ? outOfStockList.slice(0, 5).map((p) => `• ${p.name} (${p.sku})`).join('\n')
    : 'None';

  // Recent sales lines
  const recentLines = recentSales.length
    ? recentSales.map((s) =>
        `• ${s.receiptNumber} | $${s.total.toFixed(2)} | ${s._count.items} item(s) | ${s.paymentMethod} | ${new Date(s.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      ).join('\n')
    : 'No recent sales';

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return `You are SmartRetail Copilot, an intelligent AI business assistant embedded in the SmartRetail POS platform.
Your role is to answer questions about THIS store's live sales, inventory, and performance data.
Be concise (2–4 sentences unless a list is needed), specific, and actionable.
Use $ for currency. Do NOT use markdown — respond in plain text only.
If the answer is not in the context below, say so clearly instead of guessing.

=== STORE SNAPSHOT — ${dateStr} at ${timeStr} ===

TODAY
• Revenue: $${todayRev.toFixed(2)} across ${todayStats._count} order(s)
• Tax collected: $${todayTax.toFixed(2)}  |  Discounts given: $${todayDiscount.toFixed(2)}
• Avg order today: $${todayStats._count > 0 ? (todayRev / todayStats._count).toFixed(2) : '0.00'}

THIS MONTH (${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})
• Revenue: $${monthRev.toFixed(2)} across ${monthStats._count} order(s)
• Average order value: $${avgOrder.toFixed(2)}
• vs Last month ($${lastMonthRev.toFixed(2)}, ${lastMonthStats._count} orders): ${monthGrowth >= 0 ? '+' : ''}${monthGrowth.toFixed(1)}%

INVENTORY
• Total active products: ${allProducts.length}
• Inventory cost value: $${totalCostValue.toFixed(2)}
• Retail value if fully sold: $${totalRetailValue.toFixed(2)}
• Potential gross profit: $${(totalRetailValue - totalCostValue).toFixed(2)}
• Low stock (at or below threshold): ${lowStockList.length} product(s)
• Out of stock: ${outOfStockList.length} product(s)

TOP 10 PRODUCTS LAST 30 DAYS (by revenue)
${topLines}

LOW STOCK ALERTS
${lowStockLines}

OUT OF STOCK
${outOfStockLines}

RECENT 5 TRANSACTIONS
${recentLines}`;
}

// ── Streaming chat ────────────────────────────────────────────────────────────

export async function* streamCopilotResponse(
  message: string,
  history: ChatHistoryItem[],
  role: Role,
  storeId?: string | null
): AsyncGenerator<string, void, unknown> {
  const systemInstruction = await buildChatContext(role, storeId);
  const genAI = getGeminiClient();

  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
  });

  // Convert to Gemini history format (exclude the current message — it goes via sendMessage)
  const geminiHistory = history.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history: geminiHistory });

  const streamResult = await chat.sendMessageStream(message);

  for await (const chunk of streamResult.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}
