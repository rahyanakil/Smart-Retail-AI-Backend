# SmartRetail AI — Backend

Express.js · TypeScript · Prisma ORM · PostgreSQL (Neon) · Google Gemini AI

REST API and AI layer powering the SmartRetail AI SaaS platform. Handles authentication, multi-tenant data access, atomic POS transactions, analytics aggregation, and AI-driven business insights via Gemini.

---

## What This API Enables

Every feature in the UX journey maps to an API capability:

| User action | API call |
|---|---|
| Owner checks morning dashboard | `GET /api/analytics/dashboard` |
| Cashier completes a sale | `POST /api/sales` (atomic transaction) |
| Owner adjusts stock after delivery | `PATCH /api/products/:id/stock` |
| Owner asks the AI Copilot a question | `POST /api/chat/stream` (SSE) |
| Owner views AI health score + forecast | `GET /api/ai/insights` + `/forecast` + `/restock` |
| Admin creates a new store | `POST /api/stores` |
| Owner adds a new cashier | `POST /api/users` |

---

## Quick Start

```bash
# From the project root — runs both servers concurrently
npm run dev

# Backend only
npm run dev:backend
# equivalent to:
cd backend && npm run dev
```

API listens on **http://localhost:4000**.

---

## Request Flow

Every request passes through this chain in order:

```
HTTP Request
  → CORS + Helmet + Rate Limiter
  → Express Router
  → Auth Middleware     (authenticate / optionalAuthenticate)
  → Role Middleware     (requireAdmin / requireOwnerOrAbove / etc.)
  → Controller          (asyncHandler wrapper)
  → Service             (business logic + Prisma queries)
  → Prisma Client
  → PostgreSQL (Neon)
```

---

## Multi-Tenant Data Isolation

Every service method receives `role` and `storeId` from the verified JWT payload and scopes every Prisma query accordingly:

```ts
const storeFilter = role !== 'ADMIN' ? { storeId: storeId ?? undefined } : {};
const results = await prisma.product.findMany({ where: { ...storeFilter, isActive: true } });
```

- **ADMIN** — sees all stores, all users, all data
- **OWNER** — sees only their store's products, sales, users, and analytics
- **CASHIER** — same store scope as Owner, but write access limited to sales

This is enforced at the service layer, not just the route layer — a manipulated JWT with an upgraded role claim cannot access another store's data.

---

## Key Files

| File | Purpose |
|---|---|
| `src/config/env.ts` | Zod validates all env vars at startup. Import `env` from here — never `process.env` directly |
| `src/middleware/auth.middleware.ts` | Verifies Bearer JWT, attaches `req.user: JWTPayload` |
| `src/middleware/role.middleware.ts` | `requireAdmin`, `requireOwnerOrAbove`, `requireSameStoreOrAdmin`, `requireSelfOrAdmin` |
| `src/middleware/error.middleware.ts` | `asyncHandler` wraps async controllers. `AppError(message, statusCode)` is the typed error class |
| `src/services/` | All business logic. Services never read `req` — they receive typed inputs |
| `api/index.ts` | Vercel serverless entry point — re-exports `app` from `src/index.ts` |

---

## API Reference

### Auth — `/api/auth` (public)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/register` | Create Cashier account → `{ user, accessToken, refreshToken }` |
| `POST` | `/login` | Authenticate → `{ user, accessToken, refreshToken }` |
| `POST` | `/refresh` | Rotate refresh token → new pair (old token invalidated) |
| `POST` | `/logout` | Invalidate one refresh token |
| `POST` | `/logout-all` | Revoke all sessions for the authenticated user |
| `GET` | `/me` | Return authenticated user's profile |
| `PATCH` | `/me` | Update name or password |

### Products — `/api/products`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Any | Paginated list. Params: `search`, `category`, `status`, `page`, `limit` |
| `POST` | `/` | Owner+ | Create product |
| `GET` | `/stats` | Any | Aggregate counts: total, in-stock, low-stock, out-of-stock |
| `GET` | `/categories` | Any | Category names with product counts |
| `GET` | `/:id` | Any | Single product detail |
| `GET` | `/:id/stock-logs` | Owner+ | Full audit trail of manual stock adjustments |
| `PUT` | `/:id` | Owner+ | Full product update |
| `PATCH` | `/:id/stock` | Owner+ | Adjust stock. Body: `{ type: 'ADD'|'REMOVE'|'SET', quantity, reason? }` |
| `DELETE` | `/:id` | Owner+ | Soft delete — sets `isActive = false` |

### Sales — `/api/sales`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Any | Paginated list. Params: `startDate`, `endDate`, `status`, `cashierId`, `page`, `limit` |
| `POST` | `/` | Any | Create sale — atomic transaction creates `Sale` + `SaleItem` rows and decrements stock |
| `GET` | `/:id` | Any | Sale detail with line items |
| `GET` | `/:id/invoice` | Any | Invoice-formatted sale data |
| `PATCH` | `/:id/status` | Owner+ | Cancel or refund — restores stock atomically |

### Analytics — `/api/analytics` (Owner+)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/dashboard` | Summary KPIs: total revenue, sales count, top products, low-stock alerts |
| `GET` | `/sales-chart?period=daily\|weekly\|monthly` | Revenue time-series for charts |
| `GET` | `/top-products?limit=N` | Best-selling products ranked by revenue |

### Users — `/api/users`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Owner+ | List users (Owner: own store only; Admin: all) |
| `POST` | `/` | Owner+ | Create user with specified role |
| `GET` | `/:id` | Self or Admin | Get user profile |
| `PUT` | `/:id` | Self or Admin | Update user |
| `DELETE` | `/:id` | Admin | Soft delete — sets `isActive = false` |

### Stores — `/api/stores`

| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/` | Admin | All stores with user/product/sale counts |
| `POST` | `/` | Admin | Create store |
| `PUT` | `/:id` | Admin | Update store |
| `DELETE` | `/:id` | Admin | Soft delete |

### AI Insights — `/api/ai` (Owner+, 8 req/min)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/forecast` | 30-day revenue forecast — pessimistic/expected/optimistic bands, weekly breakdown |
| `GET` | `/insights` | Business health score (0–100), label, opportunities list, risks list |
| `GET` | `/restock` | Per-product urgency, reorder quantity, days remaining, estimated cost |
| `GET` | `/behavior` | Customer behavior: peak hours, payment preferences, basket size trends |

### AI Copilot — `/api/chat` (Any auth, 20 msg/min)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/stream` | `{ message, history }` | SSE stream of Gemini tokens, grounded in live store snapshot |

---

## AI Architecture

### Batch Analysis (`src/services/ai.service.ts`)

Each of the four AI endpoints follows the same pattern:

1. Fetch live Prisma data (sales history, inventory levels, recent transactions)
2. Build a context-rich prompt with that data embedded as structured text
3. Call Gemini with `responseMimeType: 'application/json'`
4. Parse and return a strongly-typed struct

The Gemini model cannot hallucinate your store's numbers — the actual data is in the prompt.

### Streaming Chat (`src/services/chat.service.ts`)

`buildChatContext(role, storeId)` runs 6 parallel Prisma queries before every chat response:
- Today's revenue vs. yesterday
- Month-to-date vs. last month
- Top 5 products by revenue
- Inventory counts (total, low stock, out of stock)
- Last 5 sales with items

This snapshot is injected as the Gemini **system instruction** so every answer is grounded in real data. If the owner asks *"What should I order this week?"*, Gemini sees the actual stock levels and sales velocity — not hypothetical data.

`streamCopilotResponse` is an async generator that yields tokens as Gemini produces them, which the controller forwards as SSE events.

The chat controller is the **only one that doesn't use `asyncHandler`** — SSE requires a long-lived open connection that can't be wrapped in a try/catch promise. It validates input synchronously before opening the stream, then catches mid-stream errors and sends them as `event: error` SSE events before calling `res.end()`.

---

## Database Schema

**`User`** — `role` (`ADMIN`/`OWNER`/`CASHIER`), optional `storeId` (null for Admins), `isActive` for soft delete.

**`Store`** — top-level multi-tenant unit. Each store is an isolated silo: its own products, sales, and users. Soft-deleted via `isActive`.

**`Product`** — belongs to a `Store`. Tracks `stock`, `lowStockAlert` threshold, `costPrice` for margin calculations, unique `sku`, optional `barcode` and `category`. Soft-deleted via `isActive`.

**`Sale`** — belongs to a `Store` and cashier `User`. Auto-generated `receiptNumber`. Status flow: `PENDING` → `COMPLETED` → `CANCELLED`/`REFUNDED`.

**`SaleItem`** — line items on a `Sale`. Records `price` at time of sale — price changes after the fact don't alter historical revenue.

**`StockLog`** — audit trail for manual adjustments only (`ADD`/`REMOVE`/`SET`). Automated POS deductions are tracked through `Sale` + `SaleItem`, not StockLog.

**`RefreshToken`** — one row per active session. Cascade-deleted when User is deleted. Invalidated on use (rotation prevents replay attacks).

### Database Commands

```bash
npm run db:push        # Push schema changes (dev — no migration file)
npm run db:migrate     # Create a tracked migration file
npm run db:reset       # Drop + migrate + re-seed
npm run db:studio      # Open Prisma Studio in the browser
npm run db:seed        # Seed demo data
npx prisma generate    # Regenerate the Prisma client after schema changes
```

---

## Security

| Measure | Implementation |
|---|---|
| Secure HTTP headers | `helmet` |
| CORS | Dev: `localhost:*`. Prod: `FRONTEND_URL` (supports comma-separated list and `*` wildcards) |
| Password hashing | `bcryptjs`, 12 salt rounds |
| JWT rotation | Refresh call issues a new pair, invalidates the old token in the DB |
| Input validation | Zod schema on every request body |
| Rate limiting | Global: 100 req/15 min. AI endpoints: 8 req/min. Chat: 20 msg/min |
| SQL injection | Impossible — Prisma uses parameterized queries only |
| Timing attack mitigation | Login always runs `bcrypt.compare` even on missing-user path (constant-time guard) |

---

## Environment Variables

```env
DATABASE_URL=           # Neon PostgreSQL connection string
JWT_SECRET=             # Min 32 characters
JWT_REFRESH_SECRET=     # Min 32 characters (defaults to JWT_SECRET + "_refresh")
JWT_EXPIRES_IN=1d
JWT_REFRESH_EXPIRES_IN=7d
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
GEMINI_API_KEY=         # From aistudio.google.com/app/apikey
GEMINI_MODEL=gemini-2.0-flash
```
