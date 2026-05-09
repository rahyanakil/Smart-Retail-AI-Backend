# SmartRetail AI — Backend

Express.js REST API with TypeScript, Prisma ORM, PostgreSQL (Neon), and Google Gemini AI.

See the [root README](../README.md) for full project setup, prerequisites, and environment variables.

---

## Quick Start

```bash
# From the project root — runs both servers concurrently (recommended)
npm run dev

# Or just the backend
npm run dev:backend
# which is equivalent to:
cd backend && npm run dev
```

The API listens on **http://localhost:4000** by default.

---

## Architecture

### Request Flow

Every request passes through this chain in order:

```
HTTP Request
  → Express Router
  → Auth Middleware     (authenticate / optionalAuthenticate)
  → Role Middleware     (requireAdmin / requireOwnerOrAbove / etc.)
  → Controller          (wrapped in asyncHandler)
  → Service             (business logic + Prisma queries)
  → Prisma Client
  → PostgreSQL (Neon)
```

### Key Files

| File | Purpose |
|---|---|
| `src/config/env.ts` | Zod validates all env vars at startup. Always import `env` from here — never `process.env` directly |
| `src/middleware/auth.middleware.ts` | `authenticate` verifies the Bearer JWT and attaches `req.user: JWTPayload`. `optionalAuthenticate` attaches it when present but doesn't block |
| `src/middleware/role.middleware.ts` | `requireAdmin`, `requireOwnerOrAbove`, `requireSameStoreOrAdmin`, `requireSelfOrAdmin` — always compose after `authenticate` |
| `src/middleware/error.middleware.ts` | `asyncHandler(fn)` wraps async controllers so rejections forward to Express's error handler. `AppError(message, statusCode)` is the typed error class |
| `src/services/` | All business logic. Services receive `role` and `storeId` from the JWT and scope queries accordingly |

### Role-Scoped Data Access

Every service method filters data based on the caller's role:

```ts
const storeFilter = role !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};
// Spread into every Prisma where clause:
const results = await prisma.product.findMany({ where: { ...storeFilter, isActive: true } });
```

`ADMIN` sees all stores. `OWNER` and `CASHIER` see only their own store.

### API Response Envelope

All responses follow this shape:

```json
{ "success": true, "data": { ... } }
{ "success": false, "message": "Human-readable error" }
```

---

## API Reference

### Auth — `/api/auth` (public)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/register` | Create account, returns `{ user, accessToken, refreshToken }` |
| `POST` | `/login` | Authenticate, returns `{ user, accessToken, refreshToken }` |
| `POST` | `/refresh` | Exchange refresh token for a new pair (old token invalidated) |
| `POST` | `/logout` | Invalidate the current refresh token |
| `GET` | `/me` | Return the authenticated user's profile |

### Products — `/api/products`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Any | Paginated list. Query params: `search`, `category`, `status` (`in_stock`/`low_stock`/`out_of_stock`), `page`, `limit` |
| `POST` | `/` | Owner+ | Create a product |
| `GET` | `/categories` | Any | Category names with product counts |
| `GET` | `/:id` | Any | Single product detail |
| `PUT` | `/:id` | Owner+ | Full update |
| `PATCH` | `/:id/stock` | Owner+ | Adjust stock. Body: `{ type: 'ADD'|'REMOVE'|'SET', quantity, reason? }`. Writes a `StockLog` row |
| `DELETE` | `/:id` | Owner+ | Soft delete — sets `isActive = false` |

### Sales — `/api/sales`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Any | Paginated list. Query params: `startDate`, `endDate`, `status`, `cashierId`, `page`, `limit` |
| `POST` | `/` | Any | Create sale. Atomic transaction: creates `Sale` + `SaleItem` rows, decrements product stock |
| `GET` | `/:id` | Any | Sale detail with line items |
| `PATCH` | `/:id/status` | Owner+ | Cancel or refund — restores stock atomically |

### Users — `/api/users`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Owner+ | List users (Owner sees only their store; Admin sees all) |
| `POST` | `/` | Owner+ | Create user |
| `GET` | `/:id` | Self or Admin | Get a user |
| `PUT` | `/:id` | Self or Admin | Update a user |
| `DELETE` | `/:id` | Admin only | Soft delete (`isActive = false`) |

### Analytics — `/api/analytics` (Owner+)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/dashboard` | Summary stats: total revenue, sales count, top products, low-stock alerts |
| `GET` | `/sales-chart?period=daily\|weekly\|monthly` | Revenue time-series for charts |
| `GET` | `/top-products` | Best-selling products ranked by total revenue |

### Stores — `/api/stores`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Admin | All stores with user/product/sales counts |
| `POST` | `/` | Admin | Create a store |
| `PUT` | `/:id` | Admin | Update a store |
| `DELETE` | `/:id` | Admin | Soft delete (`isActive = false`) |

### AI Insights — `/api/ai` (Owner+, rate-limited: 8 req/min)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/forecast` | 30-day revenue forecast — low/expected/high bands, weekly breakdown |
| `GET` | `/insights` | Business health score (0–100), label, opportunities list, risks list |
| `GET` | `/restock` | Per-product restock recommendations with urgency level and estimated cost |
| `GET` | `/behavior` | Customer behavior: peak hours, payment preferences, basket size trends |

### AI Copilot — `/api/chat` (Any authenticated, rate-limited: 20 msg/min)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/stream` | `{ message: string, history: [{role, content}] }` | SSE stream of Gemini tokens, grounded in live store data |

---

## Database Schema

### Models Overview

**`User`** — has `role` (`ADMIN`/`OWNER`/`CASHIER`), belongs to a `Store` (nullable for Admins), soft-deleted via `isActive`.

**`Store`** — top-level multi-tenant unit. Each store has its own users, products, and sales. Soft-deleted via `isActive`.

**`Product`** — belongs to a `Store`. Tracks `stock`, `lowStockAlert` threshold, `costPrice` (for margin calculations), unique `sku`, optional `barcode` and `category`. Soft-deleted via `isActive`.

**`Sale`** — belongs to a `Store` and a cashier (`User`). Has a unique auto-generated `receiptNumber`. Status: `PENDING` → `COMPLETED` → `CANCELLED`/`REFUNDED`.

**`SaleItem`** — line items on a `Sale`. Records `price` at time of sale, not the current product price.

**`StockLog`** — audit trail for manual stock adjustments (`ADD`/`REMOVE`/`SET`) only. Automated POS deductions are tracked through `Sale` + `SaleItem` instead.

**`RefreshToken`** — one row per active session. Cascade-deleted when the User is deleted. Invalidated on use (rotation).

### Database Commands

```bash
# Push schema to the database (no migration file — fast for dev)
npm run db:push

# Create a tracked migration file (use before committing schema changes)
npm run db:migrate

# Drop all data, re-run migrations, and re-seed
npm run db:reset

# Open Prisma Studio in the browser
npm run db:studio

# Regenerate the Prisma client after schema changes
npx prisma generate
```

---

## AI Subsystem

### How Batch Analysis Works (`src/services/ai.service.ts`)

Four standalone async functions. Each one:

1. Fetches live data from Prisma (sales history, inventory levels, etc.)
2. Builds a detailed prompt with that data embedded
3. Calls Gemini with `responseMimeType: 'application/json'`
4. Parses and returns a strongly-typed struct

| Function | Returns |
|---|---|
| `forecastSales` | `SalesForecast` — 30-day projection with weekly breakdown and confidence bands |
| `generateBusinessInsights` | `BusinessInsights` — health score, label, array of opportunities and risks |
| `getRestockRecommendations` | `RestockRecommendations` — per-product urgency, reorder qty, estimated cost |
| `analyzeCustomerBehavior` | `CustomerBehavior` — peak hours, payment preferences, basket size |

### How Streaming Chat Works (`src/services/chat.service.ts`)

**`buildChatContext(role, storeId)`** — runs 6 parallel Prisma queries to build a live store snapshot:
- Today's revenue vs. yesterday
- This month vs. last month
- Top 5 products by revenue
- Inventory: total products, low stock count, out of stock count
- Last 5 sales

This snapshot is injected as the Gemini **system instruction** so every answer is grounded in the user's actual data.

**`streamCopilotResponse(message, history, role, storeId)`** — async generator that calls `chat.sendMessageStream()` and yields tokens as they arrive.

The chat controller is the **only controller that does not use `asyncHandler`** — SSE requires a long-lived open connection. It validates input synchronously before starting the stream, then catches mid-stream errors and sends them as `event: error` SSE events before calling `res.end()`.

### Adding a Gemini Key Error

Both `ai.service.ts` and `chat.service.ts` have their own `getGeminiClient()` helper that throws `AppError('GEMINI_API_KEY is not configured', 503)` when the key is missing. They are intentionally duplicated — sharing state between the batch and streaming subsystems would create coupling that's harder to debug.

---

## Security

| Measure | Implementation |
|---|---|
| Secure HTTP headers | `helmet` middleware |
| CORS | Dev: allows all `localhost:*`. Prod: locked to `FRONTEND_URL` |
| Password hashing | `bcryptjs` with 10 salt rounds |
| JWT rotation | Each refresh call issues a new pair and invalidates the old token in the `RefreshToken` table |
| Input validation | Zod schemas on every request body |
| Rate limiting | `express-rate-limit` — 100 req/15 min global, 8 req/min on `/api/ai`, 20 msg/min on `/api/chat` |
| SQL injection | Impossible — Prisma uses parameterized queries exclusively |
