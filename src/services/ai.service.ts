import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import { geminiQueue } from '../lib/geminiQueue';
import { keyRotator } from '../lib/keyRotator';
import { Role } from '../types';

// ── Output types ──────────────────────────────────────────────────────────────

export interface SalesForecast {
  period: string;
  predictedRevenue: { min: number; max: number; expected: number };
  trend: 'up' | 'down' | 'stable';
  trendPercent: number;
  weeklyBreakdown: Array<{
    week: string;
    expectedRevenue: number;
    confidence: 'high' | 'medium' | 'low';
  }>;
  keyFactors: string[];
  recommendations: string[];
  generatedAt: string;
}

export interface BusinessInsight {
  category: 'revenue' | 'inventory' | 'operations' | 'growth';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  action: string;
}

export interface BusinessInsights {
  healthScore: number;
  healthLabel: string;
  summary: string;
  insights: BusinessInsight[];
  opportunities: string[];
  risks: string[];
  generatedAt: string;
}

export interface RestockItem {
  productId: string;
  name: string;
  sku: string;
  currentStock: number;
  recommendedReorderQty: number;
  estimatedDaysLeft: number;
  urgency: 'critical' | 'high' | 'medium';
  reason: string;
  estimatedCost: number;
}

export interface RestockRecommendations {
  summary: string;
  totalAtRisk: number;
  criticalCount: number;
  highCount: number;
  items: RestockItem[];
  totalInvestmentEstimate: number;
  generatedAt: string;
}

export interface CustomerBehavior {
  peakHours: Array<{ hour: string; label: string; orderCount: number; revenueShare: number }>;
  peakDays: Array<{ day: string; orderCount: number; revenueShare: number }>;
  averageBasketSize: number;
  averageTransactionValue: number;
  paymentMethodSplit: Record<string, number>;
  topCategories: Array<{ category: string; orderCount: number; revenueShare: number }>;
  insights: string[];
  recommendations: string[];
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeClient(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

function isQuotaError(message: string): boolean {
  return message.includes('RESOURCE_EXHAUSTED') || message.includes('429');
}

async function executeWithKey(apiKey: string, prompt: string): Promise<string> {
  const model = makeClient(apiKey).getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      topP: 0.8,
      // 4096 prevents restock/behavior responses (many items) from being truncated mid-JSON
      maxOutputTokens: 4096,
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Robustly parses a JSON string from Gemini output.
 *
 * Gemini's responseMimeType:'application/json' doesn't guarantee valid JSON.
 * Handles: markdown fences, trailing commas, JS comments, leading prose, truncation.
 */
function safeParseJson<T>(raw: string, context: string): T {
  // 1. Strip markdown fences (single and double-pass to handle nested)
  let text = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();

  // 2. Extract the outermost JSON object or array — discard any prose wrapper
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  let start = -1;
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) start = objStart;
  else if (arrStart !== -1) start = arrStart;

  if (start > 0) text = text.slice(start);

  // 3. Remove JavaScript-style line comments (// ...) and block comments (/* ... */)
  text = text
    .replace(/\/\/[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // 4. Remove trailing commas before } or ] (most common Gemini quirk)
  text = text.replace(/,(\s*[}\]])/g, '$1');

  // 5. Attempt parse — on failure, surface the raw snippet to aid debugging
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const snippet = text.slice(0, 300).replace(/\n/g, '\\n');
    throw new AppError(
      `Gemini returned malformed JSON for ${context}. Snippet: ${snippet}`,
      502
    );
  }
}

async function callGemini(prompt: string): Promise<string> {
  if (keyRotator.count() === 0) {
    throw new AppError('Gemini API key not configured. Add GEMINI_API_KEY to backend/.env', 503);
  }

  // Serialize all Gemini calls through the queue (500 ms cooldown between calls).
  // Within each queue slot, we get a key from the rotator. If that key is
  // quota-exhausted, we immediately try the next key once before giving up.
  return geminiQueue.run(async () => {
    const primaryKey = keyRotator.next();

    try {
      return await executeWithKey(primaryKey, prompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('API_KEY_INVALID') || message.includes('INVALID_ARGUMENT')) {
        throw new AppError('Invalid Gemini API key. Check your .env file.', 503);
      }

      if (isQuotaError(message)) {
        // Try the next key if one is available
        const fallbackKey = keyRotator.peek();
        if (fallbackKey && fallbackKey !== primaryKey) {
          keyRotator.next(); // advance cursor past this fallback
          try {
            return await executeWithKey(fallbackKey, prompt);
          } catch (fallbackErr: unknown) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            if (isQuotaError(fbMsg)) {
              throw new AppError(
                'All Gemini API keys have hit their quota. Results are cached — refresh in a minute.',
                429
              );
            }
            throw new AppError(`AI generation failed: ${fbMsg}`, 502);
          }
        }
        throw new AppError(
          'Gemini quota exceeded. Add a second API key (GEMINI_API_KEY_1) to double your limit.',
          429
        );
      }

      throw new AppError(`AI generation failed: ${message}`, 502);
    }
  });
}

export function getAiKeyStatus() {
  const count = keyRotator.count();
  return {
    keysConfigured: count,
    effectiveRpm: count * 15,
    tip: count < 2
      ? 'Add GEMINI_API_KEY_1 (and GEMINI_API_KEY_2) to double/triple your free-tier RPM'
      : `${count} keys active — effective quota: ${count * 15} RPM`,
  };
}

function storeFilter(role: Role, storeId?: string | null) {
  return role !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};
}

// ── 1. Sales Forecast ─────────────────────────────────────────────────────────

export async function forecastSales(role: Role, storeId?: string | null): Promise<SalesForecast> {
  const sf = storeFilter(role, storeId);
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);

  const [recentSales, topItems, monthStats] = await Promise.all([
    // Daily sales for the past 90 days
    prisma.sale.findMany({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: ninetyDaysAgo } },
      select: { total: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Top 10 products by revenue in last 30 days
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: { status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo }, ...sf },
      },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 10,
    }),
    // Month-over-month
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } },
      _sum: { total: true },
      _count: true,
      _avg: { total: true },
    }),
  ]);

  // Aggregate daily revenue for the prompt
  const dailyMap: Record<string, { revenue: number; count: number }> = {};
  for (const s of recentSales) {
    const key = s.createdAt.toISOString().slice(0, 10);
    if (!dailyMap[key]) dailyMap[key] = { revenue: 0, count: 0 };
    dailyMap[key].revenue += s.total;
    dailyMap[key].count += 1;
  }

  const dailySeries = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100) / 100, orders: d.count }));

  // Compute week-over-week averages for trend
  const weeklyAvgs: number[] = [];
  for (let w = 0; w < 12; w++) {
    const weekData = dailySeries.slice(Math.max(0, dailySeries.length - (w + 1) * 7), dailySeries.length - w * 7);
    if (weekData.length) {
      weeklyAvgs.unshift(weekData.reduce((s, d) => s + d.revenue, 0));
    }
  }

  const productIds = topItems.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true, stock: true },
  });

  const topProductsContext = topItems.map((item) => {
    const p = products.find((x) => x.id === item.productId);
    return {
      name: p?.name ?? 'Unknown',
      currentStock: p?.stock ?? 0,
      revenueLast30d: Math.round((item._sum.total ?? 0) * 100) / 100,
      unitsSold: item._sum.quantity ?? 0,
    };
  });

  const schema = `{
  "period": "string (e.g. 'Next 30 days')",
  "predictedRevenue": { "min": number, "max": number, "expected": number },
  "trend": "'up' | 'down' | 'stable'",
  "trendPercent": number,
  "weeklyBreakdown": [
    { "week": "string (e.g. 'Week 1 (May 12-18)')", "expectedRevenue": number, "confidence": "'high'|'medium'|'low'" }
  ],
  "keyFactors": ["string"],
  "recommendations": ["string"]
}`;

  const prompt = `You are an expert retail sales forecasting AI. Analyze the following sales data and generate a 30-day sales forecast.

## Historical Daily Sales (last 90 days)
${JSON.stringify(dailySeries.slice(-30), null, 2)}

## Weekly Revenue Totals (last 12 weeks, oldest to newest)
${JSON.stringify(weeklyAvgs.map((v, i) => ({ week: `Week ${i + 1}`, revenue: Math.round(v * 100) / 100 })), null, 2)}

## Last 30 Days Summary
- Total Revenue: $${Math.round((monthStats._sum.total ?? 0) * 100) / 100}
- Total Orders: ${monthStats._count}
- Average Order Value: $${Math.round((monthStats._avg.total ?? 0) * 100) / 100}

## Top Performing Products (last 30 days)
${JSON.stringify(topProductsContext, null, 2)}

## Today's Date
${now.toISOString().slice(0, 10)}

## Instructions
- Analyze trends, seasonality, and growth patterns
- Provide a realistic 30-day forecast with weekly breakdown
- All revenue values must be numbers (no currency symbols)
- trendPercent should be a positive number (e.g. 12.5 for +12.5%)
- Include 3-5 key factors driving the forecast and 3-5 actionable recommendations
- Be realistic — if data is sparse, widen the min/max range and lower confidence

Respond ONLY with valid JSON matching this exact schema:
${schema}`;

  const raw = await callGemini(prompt);
  const parsed = safeParseJson<SalesForecast>(raw, 'sales forecast');
  return { ...parsed, generatedAt: new Date().toISOString() };
}

// ── 2. Business Insights ──────────────────────────────────────────────────────

export async function generateBusinessInsights(role: Role, storeId?: string | null): Promise<BusinessInsights> {
  const sf = storeFilter(role, storeId);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const ninetyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);

  const [
    revenueThisMonth,
    revenueLastMonth,
    revenueTotalAllTime,
    topProducts,
    inventoryStats,
    monthlySeries,
  ] = await Promise.all([
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.aggregate({
      where: { ...sf, status: 'COMPLETED' },
      _sum: { total: true },
    }),
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'COMPLETED', createdAt: { gte: ninetyDaysAgo }, ...sf } },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 8,
    }),
    prisma.product.aggregate({
      where: { ...sf, isActive: true },
      _count: true,
      _sum: { stock: true },
    }),
    // Monthly revenue for the last 12 months
    prisma.sale.findMany({
      where: { ...sf, status: 'COMPLETED', createdAt: { gte: new Date(now.getFullYear() - 1, now.getMonth(), 1) } },
      select: { total: true, createdAt: true },
    }),
  ]);

  // Low stock products
  const lowStockProducts = await prisma.product.findMany({
    where: { ...sf, isActive: true },
    select: { name: true, stock: true, lowStockAlert: true, category: true },
  });
  const lowStockCount = lowStockProducts.filter((p) => p.stock <= p.lowStockAlert).length;

  // Build monthly revenue series
  const monthlyMap: Record<string, number> = {};
  for (const s of monthlySeries) {
    const key = `${s.createdAt.getFullYear()}-${String(s.createdAt.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap[key] = (monthlyMap[key] ?? 0) + s.total;
  }
  const monthlyRevenueSeries = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }));

  const productIds = topProducts.map((i) => i.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, category: true },
  });

  const topProductsContext = topProducts.map((item) => ({
    name: products.find((p) => p.id === item.productId)?.name ?? 'Unknown',
    category: products.find((p) => p.id === item.productId)?.category ?? 'Uncategorized',
    revenue90d: Math.round((item._sum.total ?? 0) * 100) / 100,
    unitsSold: item._sum.quantity ?? 0,
  }));

  const thisMonthRev = revenueThisMonth._sum.total ?? 0;
  const lastMonthRev = revenueLastMonth._sum.total ?? 0;
  const growthPct = lastMonthRev > 0 ? ((thisMonthRev - lastMonthRev) / lastMonthRev) * 100 : 0;

  const schema = `{
  "healthScore": number (0-100),
  "healthLabel": "string (e.g. 'Excellent', 'Good', 'Fair', 'Needs Attention')",
  "summary": "string (2-3 sentence executive summary)",
  "insights": [
    {
      "category": "'revenue'|'inventory'|'operations'|'growth'",
      "title": "string",
      "description": "string",
      "impact": "'high'|'medium'|'low'",
      "action": "string (specific next step)"
    }
  ],
  "opportunities": ["string"],
  "risks": ["string"]
}`;

  const prompt = `You are a senior retail business analyst. Analyze this business data and generate actionable insights.

## Revenue Performance
- All-Time Total Revenue: $${Math.round((revenueTotalAllTime._sum.total ?? 0) * 100) / 100}
- This Month Revenue: $${Math.round(thisMonthRev * 100) / 100} (${revenueThisMonth._count} orders)
- Last Month Revenue: $${Math.round(lastMonthRev * 100) / 100} (${revenueLastMonth._count} orders)
- Month-over-Month Growth: ${growthPct.toFixed(1)}%

## Monthly Revenue Trend (last 12 months)
${JSON.stringify(monthlyRevenueSeries, null, 2)}

## Inventory Health
- Total Active Products: ${inventoryStats._count}
- Total Units in Stock: ${inventoryStats._sum.stock ?? 0}
- Low/Out of Stock Products: ${lowStockCount} out of ${inventoryStats._count}

## Top 8 Products by Revenue (last 90 days)
${JSON.stringify(topProductsContext, null, 2)}

## Instructions
- healthScore: integer 0-100 reflecting overall business health
- Provide 4-6 insights covering different categories (revenue, inventory, operations, growth)
- Each insight must have a specific, actionable next step
- Opportunities should be growth levers
- Risks should be threats to address within 30 days
- Be specific with numbers where possible
- If data is limited, note that in the summary

Respond ONLY with valid JSON matching this exact schema:
${schema}`;

  const raw = await callGemini(prompt);
  const parsed = safeParseJson<BusinessInsights>(raw, 'business insights');
  return { ...parsed, generatedAt: new Date().toISOString() };
}

// ── 3. Restock Recommendations ────────────────────────────────────────────────

export async function getRestockRecommendations(role: Role, storeId?: string | null): Promise<RestockRecommendations> {
  const sf = storeFilter(role, storeId);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [products, salesVelocity] = await Promise.all([
    prisma.product.findMany({
      where: { ...sf, isActive: true },
      select: { id: true, name: true, sku: true, stock: true, lowStockAlert: true, costPrice: true, price: true, category: true },
      orderBy: { stock: 'asc' },
    }),
    // Units sold per product in last 30 days
    prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo }, ...sf } },
      _sum: { quantity: true },
    }),
  ]);

  const velocityMap = new Map(salesVelocity.map((v) => [v.productId, v._sum.quantity ?? 0]));

  // Build context: only include products that are low/out of stock OR have high velocity
  const productsContext = products
    .map((p) => {
      const soldLast30d = velocityMap.get(p.id) ?? 0;
      const dailyVelocity = soldLast30d / 30;
      const daysLeft = dailyVelocity > 0 ? Math.round(p.stock / dailyVelocity) : null;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category ?? 'Uncategorized',
        currentStock: p.stock,
        lowStockThreshold: p.lowStockAlert,
        unitsSoldLast30d: soldLast30d,
        dailyVelocity: Math.round(dailyVelocity * 10) / 10,
        estimatedDaysLeft: daysLeft,
        costPrice: p.costPrice,
        isLowStock: p.stock <= p.lowStockAlert,
      };
    })
    .filter((p) => p.isLowStock || (p.estimatedDaysLeft !== null && p.estimatedDaysLeft <= 14));

  const schema = `{
  "summary": "string",
  "totalAtRisk": number,
  "criticalCount": number,
  "highCount": number,
  "items": [
    {
      "productId": "string",
      "name": "string",
      "sku": "string",
      "currentStock": number,
      "recommendedReorderQty": number,
      "estimatedDaysLeft": number,
      "urgency": "'critical'|'high'|'medium'",
      "reason": "string",
      "estimatedCost": number
    }
  ],
  "totalInvestmentEstimate": number
}`;

  const prompt = `You are a retail inventory management expert. Analyze this inventory data and provide restock recommendations.

## Products Requiring Attention
${JSON.stringify(productsContext, null, 2)}

## Urgency Criteria
- critical: stock = 0 OR estimatedDaysLeft <= 3
- high: estimatedDaysLeft <= 7 OR stock <= 50% of lowStockThreshold
- medium: stock <= lowStockThreshold

## Instructions
- Only include products from the provided list
- recommendedReorderQty: enough to cover 30 days of sales + 20% safety buffer (minimum 1)
- estimatedCost = recommendedReorderQty × costPrice
- totalInvestmentEstimate = sum of all estimatedCost values
- Sort items by urgency (critical first, then high, then medium)
- If productsContext is empty, return summary saying all products are well stocked with empty items array
- reason should be a brief, specific explanation (e.g. "Selling 5 units/day with only 8 in stock")

Respond ONLY with valid JSON matching this exact schema:
${schema}`;

  const raw = await callGemini(prompt);
  const parsed = safeParseJson<RestockRecommendations>(raw, 'restock recommendations');
  return { ...parsed, generatedAt: new Date().toISOString() };
}

// ── 4. Customer Behavior Analysis ─────────────────────────────────────────────

export async function analyzeCustomerBehavior(role: Role, storeId?: string | null): Promise<CustomerBehavior> {
  const sf = storeFilter(role, storeId);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const sales = await prisma.sale.findMany({
    where: { ...sf, status: 'COMPLETED', createdAt: { gte: ninetyDaysAgo } },
    select: {
      id: true,
      total: true,
      paymentMethod: true,
      createdAt: true,
      items: {
        select: {
          quantity: true,
          total: true,
          product: { select: { category: true } },
        },
      },
    },
  });

  if (sales.length === 0) {
    return {
      peakHours: [],
      peakDays: [],
      averageBasketSize: 0,
      averageTransactionValue: 0,
      paymentMethodSplit: {},
      topCategories: [],
      insights: ['No sales data available for the selected period.'],
      recommendations: ['Start recording sales to unlock customer behavior insights.'],
      generatedAt: new Date().toISOString(),
    };
  }

  // Pre-aggregate client-side to minimize prompt token usage
  const hourMap: Record<number, { count: number; revenue: number }> = {};
  const dayMap: Record<number, { count: number; revenue: number }> = {};
  const paymentMap: Record<string, number> = {};
  const categoryMap: Record<string, { count: number; revenue: number }> = {};
  let totalBasketItems = 0;

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const sale of sales) {
    const hour = sale.createdAt.getHours();
    const day = sale.createdAt.getDay();

    hourMap[hour] = hourMap[hour] ?? { count: 0, revenue: 0 };
    hourMap[hour].count += 1;
    hourMap[hour].revenue += sale.total;

    dayMap[day] = dayMap[day] ?? { count: 0, revenue: 0 };
    dayMap[day].count += 1;
    dayMap[day].revenue += sale.total;

    paymentMap[sale.paymentMethod] = (paymentMap[sale.paymentMethod] ?? 0) + 1;

    for (const item of sale.items) {
      const cat = item.product?.category ?? 'Uncategorized';
      categoryMap[cat] = categoryMap[cat] ?? { count: 0, revenue: 0 };
      categoryMap[cat].count += item.quantity;
      categoryMap[cat].revenue += item.total;
      totalBasketItems += item.quantity;
    }
  }

  const totalRevenue = sales.reduce((s, x) => s + x.total, 0);

  const hourData = Object.entries(hourMap)
    .map(([h, d]) => ({
      hour: `${h.padStart(2, '0')}:00`,
      label: formatHour(Number(h)),
      orderCount: d.count,
      revenueShare: Math.round((d.revenue / totalRevenue) * 1000) / 10,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 8);

  const dayData = Object.entries(dayMap)
    .map(([d, v]) => ({
      day: DAY_NAMES[Number(d)],
      orderCount: v.count,
      revenueShare: Math.round((v.revenue / totalRevenue) * 1000) / 10,
    }))
    .sort((a, b) => b.orderCount - a.orderCount);

  const paymentTotal = Object.values(paymentMap).reduce((s, v) => s + v, 0);
  const paymentSplit = Object.fromEntries(
    Object.entries(paymentMap).map(([k, v]) => [k, Math.round((v / paymentTotal) * 1000) / 10])
  );

  const categoryData = Object.entries(categoryMap)
    .map(([cat, d]) => ({
      category: cat,
      orderCount: d.count,
      revenueShare: Math.round((d.revenue / totalRevenue) * 1000) / 10,
    }))
    .sort((a, b) => b.revenueShare - a.revenueShare)
    .slice(0, 8);

  const avgBasket = totalBasketItems / sales.length;
  const avgTransaction = totalRevenue / sales.length;

  const schema = `{
  "peakHours": [{ "hour": "string", "label": "string", "orderCount": number, "revenueShare": number }],
  "peakDays": [{ "day": "string", "orderCount": number, "revenueShare": number }],
  "averageBasketSize": number,
  "averageTransactionValue": number,
  "paymentMethodSplit": { "METHOD": number },
  "topCategories": [{ "category": "string", "orderCount": number, "revenueShare": number }],
  "insights": ["string"],
  "recommendations": ["string"]
}`;

  const prompt = `You are a retail customer behavior analyst. Analyze these pre-aggregated shopping patterns and generate insights.

## Analysis Period
Last 90 days — ${sales.length} total transactions

## Hourly Traffic (top 8 hours by order count)
${JSON.stringify(hourData, null, 2)}

## Daily Traffic Pattern
${JSON.stringify(dayData, null, 2)}

## Payment Method Distribution (%)
${JSON.stringify(paymentSplit, null, 2)}

## Top Product Categories (by revenue share %)
${JSON.stringify(categoryData, null, 2)}

## Key Metrics
- Average Basket Size: ${avgBasket.toFixed(2)} items per transaction
- Average Transaction Value: $${avgTransaction.toFixed(2)}

## Instructions
- Return the pre-aggregated data exactly as provided (do not recalculate)
- averageBasketSize: ${avgBasket.toFixed(2)} (use this exact value)
- averageTransactionValue: ${avgTransaction.toFixed(2)} (use this exact value)
- paymentMethodSplit: use the exact percentages provided
- Provide 4-5 insights about shopping patterns, timing, and customer preferences
- Provide 3-4 specific, actionable recommendations (e.g. staffing, promotions, inventory timing)

Respond ONLY with valid JSON matching this exact schema:
${schema}`;

  const raw = await callGemini(prompt);
  const parsed = safeParseJson<CustomerBehavior>(raw, 'customer behavior');
  return { ...parsed, generatedAt: new Date().toISOString() };
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// ── Status check ──────────────────────────────────────────────────────────────

export function getAiStatus() {
  const keyCount = keyRotator.count();
  return {
    configured: keyCount > 0,
    model: env.GEMINI_MODEL,
    provider: 'Google Gemini (free tier)',
    keysConfigured: keyCount,
    effectiveRpm: keyCount * 15,
  };
}
