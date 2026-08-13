// ============================================================
// Core test suite — all 5 mandated scenarios
// ============================================================
//
// Run with: npm test
// Requires: supabase start + seed.sql applied
//
// Test 5 note: We fire two requests with Promise.all — they execute
// concurrently in the same event loop tick, landing on the server
// at effectively the same time. The FOR UPDATE lock in the DB ensures
// exactly one succeeds and one gets 409.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getTokens, PRODUCT_ID, LAST_ITEM_ID } from './helpers.js';
import { pool } from '../src/config/db.js';

const app = createApp();

let sellerAToken: string;
let sellerBToken: string;
let customerToken: string;
let createdProductId: string;

beforeAll(async () => {
  const tokens = await getTokens();
  sellerAToken  = tokens.sellerAToken;
  sellerBToken  = tokens.sellerBToken;
  customerToken = tokens.customerToken;

  // Reset the last-item stock to 1 before each test run
  await pool.query(
    `UPDATE inventory SET stock_qty = 1 WHERE product_id = $1`,
    [LAST_ITEM_ID]
  );
});

// ── Test 1: Seller A creates a product ──────────────────────
describe('Test 1: Seller A creates a product', () => {
  it('returns 201 with the created product', async () => {
    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${sellerAToken}`)
      .send({
        name:        'Test Headphones',
        description: 'Great sound quality',
        category:    'electronics',
        price_minor: 15000,
        stock_qty:   10,
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Test Headphones', price_minor: 15000 });

    createdProductId = res.body.id;
  });
});

// ── Test 2: Seller B attempts to modify Seller A's product ──
describe('Test 2: Seller B cannot modify Seller A\'s product', () => {
  it('returns 403 or 404 — denied at the database level', async () => {
    const res = await request(app)
      .patch(`/products/${createdProductId}`)
      .set('Authorization', `Bearer ${sellerBToken}`)
      .send({ name: 'Hacked Name' });

    // RLS at the DB level means the UPDATE affects 0 rows,
    // which Supabase returns as a not-found or forbidden.
    expect([403, 404]).toContain(res.status);
  });
});

// ── Test 3: Customer orders an available product ─────────────
describe('Test 3: Customer orders an available product', () => {
  it('returns 201 with the created order', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `test-3-${Date.now()}`)
      .send({
        items: [{ product_id: PRODUCT_ID, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('total_minor');
  });
});

// ── Test 4: Customer orders more than stock ──────────────────
describe('Test 4: Customer cannot order more than stock', () => {
  it('returns 409 OUT_OF_STOCK when quantity exceeds stock', async () => {
    const res = await request(app)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `test-4-${Date.now()}`)
      .send({
        items: [{ product_id: LAST_ITEM_ID, quantity: 999 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });
});

// ── Test 5: Two simultaneous orders for the last item ────────
//
// This is the concurrency test. We fire two requests at the same
// time using Promise.all. The SELECT FOR UPDATE in the transaction
// ensures exactly one succeeds and the other is rejected.
//
// A sequential test would NOT catch concurrency bugs — this one does.

describe('Test 5: Concurrent orders for the last item', () => {
  it('exactly one succeeds and one gets 409', async () => {
    // Reset stock to 1
    await pool.query(`UPDATE inventory SET stock_qty = 1 WHERE product_id = $1`, [LAST_ITEM_ID]);

    const makeOrder = (key: string) =>
      request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send({ items: [{ product_id: LAST_ITEM_ID, quantity: 1 }] });

    // Fire both requests simultaneously
    const [res1, res2] = await Promise.all([
      makeOrder(`concurrent-a-${Date.now()}`),
      makeOrder(`concurrent-b-${Date.now()}`),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one 201 and one 409
    expect(statuses).toEqual([201, 409]);

    // Verify stock is now 0
    const { rows } = await pool.query(
      `SELECT stock_qty FROM inventory WHERE product_id = $1`,
      [LAST_ITEM_ID]
    );
    expect(rows[0]!.stock_qty).toBe(0);
  });
});
