// Product service — all database logic for product operations.
// Routes call these functions; they never touch the DB directly.

import { adminDb } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';
import type { ProductStatus } from '../types/index.js';

// ── Create ──────────────────────────────────────────────────

export async function createProduct(
  storeId: string,
  data: { name: string; description?: string; category?: string; price_minor: number; status?: ProductStatus }
) {
  const { data: product, error } = await adminDb
    .from('products')
    .insert({ store_id: storeId, ...data })
    .select()
    .single();

  if (error) throw error;

  // Create an inventory row with 0 stock
  await adminDb.from('inventory').insert({ product_id: product.id, stock_qty: 0 });

  return product;
}

// ── Get one ─────────────────────────────────────────────────

export async function getProductById(productId: string) {
  const { data, error } = await adminDb
    .from('products')
    .select('*, inventory(stock_qty)')
    .eq('id', productId)
    .single();

  if (error || !data) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  return data;
}

// ── List (seller's own) ──────────────────────────────────────

export async function listSellerProducts(storeId: string) {
  const { data, error } = await adminDb
    .from('products')
    .select('*, inventory(stock_qty)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ── Update ───────────────────────────────────────────────────

export async function updateProduct(
  productId: string,
  storeId: string,
  data: Partial<{ name: string; description: string; category: string; price_minor: number; status: ProductStatus; stock_qty: number }>
) {
  const { stock_qty, ...productFields } = data;

  // Update product fields (if any)
  if (Object.keys(productFields).length > 0) {
    const { error } = await adminDb
      .from('products')
      .update(productFields)
      .eq('id', productId)
      .eq('store_id', storeId); // RLS safety net: also enforce in query

    if (error) throw error;
  }

  // Update inventory separately (if stock_qty was provided)
  if (stock_qty !== undefined) {
    const { error } = await adminDb
      .from('inventory')
      .update({ stock_qty })
      .eq('product_id', productId);

    if (error) throw error;
  }

  return getProductById(productId);
}

// ── Archive (soft delete) ────────────────────────────────────

export async function archiveProduct(productId: string, storeId: string) {
  const { error } = await adminDb
    .from('products')
    .update({ status: 'ARCHIVED' })
    .eq('id', productId)
    .eq('store_id', storeId);

  if (error) throw error;
}

// ── Search + paginated public listing ───────────────────────
//
// Uses keyset pagination (cursor on created_at + id) — not OFFSET —
// so it stays fast at 1M+ rows.
//
// Full-text search goes through the precomputed `search_vector` GIN index.

export async function searchProducts(params: {
  search?:    string;
  category?:  string;
  min_price?: number;
  max_price?: number;
  in_stock?:  boolean;
  sort?:      'price_asc' | 'price_desc' | 'newest';
  cursor?:    string; // JSON-encoded { created_at, id }
  limit?:     number;
}) {
  const limit = Math.min(params.limit ?? 20, 100);

  let query = adminDb
    .from('products')
    .select('*, inventory(stock_qty)')
    .eq('status', 'ACTIVE');

  if (params.search) {
    query = query.textSearch('search_vector', params.search, { type: 'websearch' });
  }

  if (params.category) {
    query = query.eq('category', params.category);
  }

  if (params.min_price !== undefined) {
    query = query.gte('price_minor', params.min_price);
  }

  if (params.max_price !== undefined) {
    query = query.lte('price_minor', params.max_price);
  }

  // Keyset cursor for pagination
  if (params.cursor) {
    const { created_at, id } = JSON.parse(Buffer.from(params.cursor, 'base64').toString());
    query = query.or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`);
  }

  // Sorting
  if (params.sort === 'price_asc')  query = query.order('price_minor', { ascending: true });
  else if (params.sort === 'price_desc') query = query.order('price_minor', { ascending: false });
  else query = query.order('created_at', { ascending: false }); // default: newest

  query = query.limit(limit + 1); // fetch one extra to determine if there's a next page

  const { data, error } = await query;
  if (error) throw error;

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;

  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ created_at: items.at(-1)!.created_at, id: items.at(-1)!.id })).toString('base64')
    : null;

  return { items, nextCursor };
}

// ── Helper: get store for a seller ──────────────────────────

export async function getStoreByOwnerId(ownerId: string) {
  const { data } = await adminDb
    .from('stores')
    .select('id')
    .eq('owner_id', ownerId)
    .single();

  if (!data) throw new AppError(404, 'STORE_NOT_FOUND', 'You do not have a store yet. Create one first.');
  return data;
}
