# Reneo Backend API

A production-quality Node.js/TypeScript/Supabase/PostgreSQL backend for Reneo, a multi-seller commerce platform for solo entrepreneurs in Africa.

---

## Quick Start

### Prerequisites
- Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (for local Supabase)

### 1. Clone and install
```bash
git clone https://github.com/shubhamkr790/reneo.git
cd reneo
npm install
```

### 2. Start local Supabase
```bash
supabase start
```
This outputs a `SUPABASE_URL`, `ANON KEY`, `SERVICE_ROLE KEY`, and a `DB URL`. Copy them.

### 3. Configure environment
```bash
cp .env.example .env
# Fill in the values from `supabase start` output
```

### 4. Apply migrations and seed
```bash
supabase db reset
# This runs migrations/ in order, then seed.sql
```

### 5. Run the API
```bash
npm run dev
# API available at http://localhost:3000
```

### 6. Run tests
```bash
npm test
```

---

## Architecture

```
┌─────────────┐     JWT      ┌──────────────────────────────────────┐
│   Client    │ ──────────► │           Express API (Node.js)       │
└─────────────┘             │                                        │
                             │  routes/    → validate input (Zod)    │
                             │  services/  → business logic          │
                             │  middleware/→ auth, roles, errors      │
                             └──────────────┬───────────────────────┘
                                            │
                          ┌─────────────────┼──────────────────────┐
                          │                 │                       │
                   ┌──────▼──────┐  ┌──────▼──────┐        ┌──────▼──────┐
                   │ Supabase    │  │  pg Pool     │        │  Supabase   │
                   │ JS Client   │  │  (raw SQL)   │        │  Realtime   │
                   │ (auth+CRUD) │  │ (FOR UPDATE  │        │  (events)   │
                   └──────┬──────┘  │  transactions│        └─────────────┘
                          │         └──────┬───────┘
                          │                │
                   ┌──────▼────────────────▼──────┐
                   │         PostgreSQL             │
                   │  (Supabase local / cloud)     │
                   └───────────────────────────────┘
```

### Two DB clients, one reason each

| Client | Key used | Purpose |
|---|---|---|
| `supabase` (anon) | `ANON_KEY` | Auth token validation |
| `adminDb` (service role) | `SERVICE_ROLE_KEY` | Admin writes that bypass RLS |
| `pool` (pg raw) | `DATABASE_URL` | `SELECT FOR UPDATE` transactions — supabase-js doesn't expose transaction control |

---

## Technical Choices

### Money: stored as `BIGINT` (minor units)
Floating-point arithmetic is unreliable for money. `0.1 + 0.2 !== 0.3` in JavaScript. All prices are stored as integers in the smallest currency unit (1 FCFA = 1 unit). Division only happens at the presentation layer. This is the same approach used by Stripe.

**Example:** 50,000 FCFA is stored as `50000`.

### Concurrency: `SELECT ... FOR UPDATE` (B1)
When two customers order the last item simultaneously:

1. Both requests enter `createOrder()` and call `BEGIN`.
2. Both reach the `SELECT ... FOR UPDATE` query.
3. One gets the lock first. The other **blocks** (does not fail — it waits).
4. The first transaction decrements stock from 1 → 0 and commits.
5. The second transaction unblocks, re-reads stock: **0**. It sees `stock_qty < quantity` and rolls back with a 409.

**What is atomic:** the stock check + decrement + order insert + event insert are all inside a single `BEGIN...COMMIT` block. Either everything happens or nothing does.

**Lock order:** We `ORDER BY product_id` before locking to prevent deadlocks when two orders contain the same products in different order.

### Pagination: Keyset (cursor-based), not `OFFSET`
`OFFSET 1000000` forces PostgreSQL to scan and discard 1 million rows. Keyset pagination uses a `WHERE created_at < :cursor` condition with an index, so performance doesn't degrade at scale.

### Full-text search: `tsvector` GIN index
The `search_vector` column is a `GENERATED ALWAYS AS` computed column — PostgreSQL maintains it automatically on insert/update. The GIN index makes `to_tsquery` searches fast even at millions of rows.

### EXPLAIN output (main search query)
```sql
EXPLAIN ANALYZE
SELECT p.*, i.stock_qty
FROM products p
JOIN inventory i ON i.product_id = p.id
WHERE p.status = 'ACTIVE'
  AND p.search_vector @@ websearch_to_tsquery('english', 'headphones')
ORDER BY p.created_at DESC
LIMIT 21;
```
*Output (from local Supabase with seed data):*
```
Limit  (cost=8.42..8.43 rows=1 width=...) (actual time=0.123..0.124 rows=0 loops=1)
  ->  Sort  (cost=8.42..8.43 rows=1 ...)
        Sort Key: p.created_at DESC
        ->  Bitmap Heap Scan on products p  (...)
              Recheck Cond: (search_vector @@ ...)
              Filter: (status = 'ACTIVE')
              ->  Bitmap Index Scan on idx_products_search  (...)
Planning Time: 0.8 ms
Execution Time: 0.2 ms
```
The GIN index (`idx_products_search`) is used for the full-text condition. The `status` filter is evaluated as a recheck. In production, a composite index on `(status, search_vector)` would further optimize this.

### Idempotency (B2)
- Client sends `Idempotency-Key: <uuid>` header on `POST /orders`.
- On first request: processed normally, response cached in `idempotency_keys` table.
- On retry: cached response returned immediately — no duplicate order created.
- Key TTL: **24 hours** (matches Stripe's model; long enough for network retry windows).
- Same key + different payload → **422**: this prevents accidentally reusing a key with a different cart.

### Events (B3)
The `ORDER_CREATED` event is inserted in the **same database transaction** as the order. This means:
- If the server crashes after order creation but before the event write → both roll back. No orphaned order without an event.
- If the event write fails → the whole transaction rolls back. No order without an event.
- **Exactly-once delivery to the DB** is guaranteed. Delivery to the seller's notification UI uses Supabase Realtime (`SELECT` on `order_events`). If the Realtime connection drops, the event is not lost — it's still in the DB and will be delivered on reconnect.

---

## API Reference

### Authentication
All protected endpoints require:
```
Authorization: Bearer <access_token>
```

### Endpoints

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/auth/register` | No | — | Register seller or customer |
| `POST` | `/auth/login` | No | — | Login, get JWT |
| `GET` | `/products` | No | — | Search + paginated list |
| `GET` | `/products/:id` | No | — | Get one product |
| `POST` | `/products` | Yes | SELLER | Create product |
| `PATCH` | `/products/:id` | Yes | SELLER | Update product |
| `DELETE` | `/products/:id` | Yes | SELLER | Archive product |
| `GET` | `/products/seller/mine` | Yes | SELLER | List own products |
| `POST` | `/orders` | Yes | CUSTOMER | Create order (idempotent) |
| `GET` | `/orders` | Yes | Any | List orders |
| `GET` | `/orders/:id` | Yes | Any | Get one order |
| `GET` | `/stores` | No | — | List all stores |
| `GET` | `/stores/me` | Yes | SELLER | Get own store |
| `PATCH` | `/stores/me` | Yes | SELLER | Update own store |

### Error shape (consistent across all endpoints)
```json
{
  "error": {
    "code": "OUT_OF_STOCK",
    "message": "Insufficient stock for \"Widget\". Available: 0",
    "details": []
  }
}
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT` | Zod validation failed |
| 401 | `UNAUTHENTICATED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Wrong role or wrong owner |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `OUT_OF_STOCK` | Concurrent stock conflict |
| 409 | `CONFLICT` | Duplicate resource |
| 422 | `IDEMPOTENCY_CONFLICT` | Same key, different payload |
| 500 | `INTERNAL_ERROR` | Unexpected error |

---

## Part D — Written Answers

### D1. Scaling to 10 million users

**What breaks first:** The single PostgreSQL instance. At high order volume, the `SELECT FOR UPDATE` contention on hot inventory rows becomes a bottleneck. The orders table grows to hundreds of millions of rows. The DB is the first limit.

**How do you know:** Monitor `pg_stat_activity` for lock waits, and track `orders_per_second` against DB CPU. When query P99 latency crosses 200ms under load, it's time to scale.

```
                        ┌─────────────────────────────┐
                        │         Load Balancer        │
                        └──────────────┬──────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                           │
     ┌──────▼──────┐           ┌───────▼──────┐          ┌───────▼──────┐
     │  API Node 1 │           │  API Node 2  │          │  API Node N  │
     └──────┬──────┘           └───────┬──────┘          └───────┬──────┘
            │                          │                           │
            └──────────────────────────┼───────────────────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │         Redis Cache          │
                        │  (product catalog, sessions) │
                        └──────────────┬──────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │   Message Queue (BullMQ)     │
                        │  (order events, emails)      │
                        └──────────────┬──────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                           │
     ┌──────▼──────┐           ┌───────▼──────┐          ┌───────▼──────┐
     │  PG Primary │◄──────────│  PG Replica  │          │  PG Replica  │
     │  (writes)   │  replicate│  (reads)     │          │  (reads)     │
     └─────────────┘           └──────────────┘          └──────────────┘
```

**Evolution steps:**
1. **Read replicas** — Route `GET /products` to replicas. Writes stay on primary.
2. **Redis cache** — Cache product catalog (TTL 60s). Invalidate on update.
3. **Horizontal API scaling** — Stateless API nodes behind a load balancer.
4. **Queue order events** — Use BullMQ/Redis to decouple notification delivery from the order transaction. The event goes into the DB (same tx) and a worker picks it up.
5. **Partitioning** — Partition `orders` by `created_at` month once it exceeds 100M rows.

**What I would NOT do yet:** Microservices. Splitting into separate services adds network latency and distributed transaction complexity before you've exhausted what a well-tuned monolith can do.

### D2. What I didn't have time to do

- **Refresh token rotation** — the login endpoint returns a refresh token but there's no `/auth/refresh` endpoint.
- **Seller inventory management endpoint** — currently stock is updated via `PATCH /products/:id` with `stock_qty`. A dedicated `PATCH /products/:id/inventory` would be cleaner.
- **Order status transitions** — sellers can't yet mark orders as CONFIRMED/SHIPPED. The `order_status` enum exists but no endpoint uses it.
- **Supabase Realtime subscription example** — the events land in the DB but I haven't written the client-side subscription code for the seller notification UI.
- **Rate limiting** — `express-rate-limit` on `/auth/*` and `POST /orders` to prevent abuse.
- **Integration test cleanup** — tests currently leave orders in the DB. A proper teardown would reset state between runs.

### D3. AI and library usage

- **Zod** — I know the API but looked up `.strict()` to confirm it rejects unknown keys (not just ignores them). The distinction matters here because we need to actively reject a `price` field from the client, not silently ignore it.
- **supabase-js `textSearch`** — I looked up the exact parameter signature for `websearch` mode vs `plain` mode. `websearch` is more forgiving of user input (handles quotes, dashes naturally).
- **AI assistant** — Used for drafting the OpenAPI spec structure. I reviewed every field and corrected the response schemas to match the actual Zod schemas in the code.

---

## Known Limitations

1. Email confirmation is required for Supabase Auth by default — in local dev, auto-confirm is enabled. In production, users would need to confirm their email before logging in.
2. The `listSellerOrders` query uses a subquery that could be slow at scale — it should be replaced with a materialized view or denormalized `store_id` column on `order_items`.
3. No rate limiting implemented.

---

## Running Tests

```bash
# Ensure supabase is running and seed is applied
supabase start
supabase db reset

# Start the API in a separate terminal
npm run dev

# Run tests
npm test
```

Test 5 (concurrent orders) fires two requests with `Promise.all` — they race to the same inventory row. The `SELECT FOR UPDATE` in the DB ensures exactly one wins.
