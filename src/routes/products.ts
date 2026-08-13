// Product routes — A3 (seller CRUD) + A4 (public search/pagination)
//
// Public GET /products is open to everyone.
// All other endpoints require SELLER role.

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import * as ProductService from '../services/product.service.js';

const router = Router();

// ── Validation schemas ───────────────────────────────────────

const CreateProductSchema = z.object({
  name:        z.string().min(1).max(255),
  description: z.string().optional(),
  category:    z.string().optional(),
  price_minor: z.number().int().positive(),
  status:      z.enum(['ACTIVE', 'DRAFT']).default('ACTIVE'),
  stock_qty:   z.number().int().min(0).default(0),
});

const UpdateProductSchema = z.object({
  name:        z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category:    z.string().optional(),
  price_minor: z.number().int().positive().optional(),
  status:      z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']).optional(),
  stock_qty:   z.number().int().min(0).optional(),
});

const SearchSchema = z.object({
  search:    z.string().optional(),
  category:  z.string().optional(),
  min_price: z.coerce.number().int().optional(),
  max_price: z.coerce.number().int().optional(),
  in_stock:  z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  sort:      z.enum(['price_asc', 'price_desc', 'newest']).optional(),
  cursor:    z.string().optional(),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

// ── Public: GET /products ────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const params = SearchSchema.parse(req.query);
    const result = await ProductService.searchProducts(params);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Public: GET /products/:id ────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const product = await ProductService.getProductById(req.params['id'] as string);
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// ── Seller: POST /products ───────────────────────────────────

router.post('/', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const body = CreateProductSchema.parse(req.body);
    const store = await ProductService.getStoreByOwnerId(req.user!.id);
    const { stock_qty, ...productData } = body;
    const product = await ProductService.createProduct(store.id, productData);

    // Set initial stock if provided
    if (stock_qty > 0) {
      await ProductService.updateProduct(product.id, store.id, { stock_qty });
    }

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// ── Seller: PATCH /products/:id ──────────────────────────────

router.patch('/:id', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const body = UpdateProductSchema.parse(req.body);
    const store = await ProductService.getStoreByOwnerId(req.user!.id);
    const product = await ProductService.updateProduct(req.params['id'] as string, store.id, body);
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// ── Seller: DELETE /products/:id (archives, doesn't hard-delete) ─

router.delete('/:id', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const store = await ProductService.getStoreByOwnerId(req.user!.id);
    await ProductService.archiveProduct(req.params['id'] as string, store.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Seller: GET /products/seller/mine ───────────────────────

router.get('/seller/mine', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const store = await ProductService.getStoreByOwnerId(req.user!.id);
    const products = await ProductService.listSellerProducts(store.id);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

export default router;
