// Order routes — customer-facing order lifecycle.
// The price in the request is deliberately absent — server resolves it.
// If a client sends a `price` field, Zod will reject it (strict mode).

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { idempotency } from '../middleware/idempotency.js';
import * as OrderService from '../services/order.service.js';

const router = Router();

// Strict: rejects any key not listed here (including `price`)
const CreateOrderSchema = z.object({
  items: z.array(
    z.object({
      product_id: z.string().uuid(),
      quantity:   z.number().int().positive(),
    })
  ).min(1),
}).strict(); // <-- rejects extra fields like `price`

// POST /orders — idempotent, customer only
router.post(
  '/',
  authenticate,
  requireRole('CUSTOMER'),
  idempotency,
  async (req, res, next) => {
    try {
      const body = CreateOrderSchema.parse(req.body);
      const order = await OrderService.createOrder(req.user!.id, body.items);
      res.status(201).json(order);
    } catch (err) {
      next(err);
    }
  }
);

// GET /orders — customer sees own orders, seller sees orders with their items
router.get('/', authenticate, async (req, res, next) => {
  try {
    if (req.user!.role === 'CUSTOMER') {
      const orders = await OrderService.listCustomerOrders(req.user!.id);
      res.json(orders);
    } else {
      // Seller: find store first
      const { adminDb } = await import('../config/supabase.js');
      const { data: store } = await adminDb
        .from('stores')
        .select('id')
        .eq('owner_id', req.user!.id)
        .single();

      const orders = store ? await OrderService.listSellerOrders(store.id) : [];
      res.json(orders);
    }
  } catch (err) {
    next(err);
  }
});

// GET /orders/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await OrderService.getOrderById(req.params['id'] as string, req.user!.id);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

export default router;
