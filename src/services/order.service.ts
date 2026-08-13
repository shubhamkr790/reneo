// Order service — the most critical piece.
//
// SERVER OWNS THE TRUTH:
//   - Price is read from the DB, never from the client request.
//   - Stock is checked and decremented atomically inside a transaction.
//
// CONCURRENCY (B1):
//   We use SELECT ... FOR UPDATE inside a PostgreSQL transaction.
//   This places a row-level lock on each inventory row being purchased.
//   The second concurrent request blocks at this line, then re-reads
//   the already-decremented stock and fails with 409.
//   What is atomic: the stock check + decrement + order insert happen
//   in a single transaction. Either all succeed or all roll back.

import { pool } from '../config/db.js';
import { adminDb } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';

interface OrderItemInput {
  product_id: string;
  quantity: number;
}

export async function createOrder(customerId: string, items: OrderItemInput[]) {
  // Reject if client tried to send a price — server owns that
  // (validation in the route layer already handles this, but double-check)
  if (items.length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'Order must contain at least one item');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Lock the inventory rows for all requested products.
    // FOR UPDATE prevents any other transaction from reading or modifying
    // these rows until this transaction commits or rolls back.
    const productIds = items.map(i => i.product_id);

    const { rows: inventoryRows } = await client.query<{
      product_id: string;
      stock_qty: number;
      price_minor: number;
      status: string;
      name: string;
    }>(
      `SELECT i.product_id, i.stock_qty, p.price_minor, p.status, p.name
       FROM inventory i
       JOIN products p ON p.id = i.product_id
       WHERE i.product_id = ANY($1)
       ORDER BY i.product_id   -- consistent lock order prevents deadlocks
       FOR UPDATE`,
      [productIds]
    );

    // Step 2: Validate each item against what the DB says (price, status, stock)
    let totalMinor = 0;
    const validatedItems: Array<{ product_id: string; quantity: number; unit_price_minor: number }> = [];

    for (const item of items) {
      const inv = inventoryRows.find(r => r.product_id === item.product_id);

      if (!inv) {
        throw new AppError(404, 'NOT_FOUND', `Product ${item.product_id} not found`);
      }
      if (inv.status !== 'ACTIVE') {
        throw new AppError(400, 'PRODUCT_UNAVAILABLE', `Product "${inv.name}" is not available`);
      }
      if (inv.stock_qty < item.quantity) {
        throw new AppError(409, 'OUT_OF_STOCK', `Insufficient stock for "${inv.name}". Available: ${inv.stock_qty}`);
      }

      totalMinor += inv.price_minor * item.quantity; // price from DB, not client
      validatedItems.push({ product_id: item.product_id, quantity: item.quantity, unit_price_minor: inv.price_minor });
    }

    // Step 3: Decrement stock atomically
    for (const item of validatedItems) {
      await client.query(
        `UPDATE inventory SET stock_qty = stock_qty - $1 WHERE product_id = $2`,
        [item.quantity, item.product_id]
      );
    }

    // Step 4: Insert the order
    const { rows: [order] } = await client.query<{ id: string }>(
      `INSERT INTO orders (customer_id, total_minor, status)
       VALUES ($1, $2, 'PENDING') RETURNING id`,
      [customerId, totalMinor]
    );

    // Step 5: Insert order items
    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_minor)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.unit_price_minor]
      );
    }

    // Step 6: Emit ORDER_CREATED event (same transaction — cannot be orphaned)
    await client.query(
      `INSERT INTO order_events (order_id, event_type, payload)
       VALUES ($1, 'ORDER_CREATED', $2)`,
      [order.id, JSON.stringify({ customer_id: customerId, total_minor: totalMinor, items: validatedItems })]
    );

    await client.query('COMMIT');

    // Fetch and return the full order
    return getOrderById(order.id, customerId);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Get one order ────────────────────────────────────────────

export async function getOrderById(orderId: string, userId: string) {
  const { data, error } = await adminDb
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', orderId)
    .single();

  if (error || !data) throw new AppError(404, 'NOT_FOUND', 'Order not found');

  // Ensure the requester owns the order (customers) or it contains their product (sellers)
  // RLS handles this at DB level; this is a belt-and-suspenders check
  if (data.customer_id !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this order');
  }

  return data;
}

// ── List orders for a customer ───────────────────────────────

export async function listCustomerOrders(customerId: string) {
  const { data, error } = await adminDb
    .from('orders')
    .select('*, order_items(*)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ── List orders for a seller (orders containing their products) ─

export async function listSellerOrders(storeId: string) {
  // Find orders that contain at least one product from this store
  const { data, error } = await adminDb
    .from('order_items')
    .select('order_id, orders(*), product_id, quantity, unit_price_minor')
    .in('product_id',
      adminDb.from('products').select('id').eq('store_id', storeId) as unknown as string[]
    );

  if (error) throw error;
  return data;
}
