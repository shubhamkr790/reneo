// Idempotency middleware for POST /orders.
//
// How it works:
// 1. Client sends `Idempotency-Key: <uuid>` header.
// 2. We check if (customer_id, key) already exists in the DB.
// 3. If yes  → return the cached response immediately (no duplicate order).
// 4. If no   → allow the request through; save response after handler runs.
//
// Key lifetime: 24 hours (set in the DB default).
//
// Same key + different payload → 422. This protects against accidental
// key reuse with a different cart, which would silently return the wrong order.

import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { adminDb } from '../config/supabase.js';

export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.headers['idempotency-key'] as string | undefined;

  if (!key) {
    res.status(400).json({
      error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' },
    });
    return;
  }

  const customerId = req.user!.id;
  const requestHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

  // Check for an existing (non-expired) record
  const { data: existing } = await adminDb
    .from('idempotency_keys')
    .select('response_body, request_hash')
    .eq('customer_id', customerId)
    .eq('idempotency_key', key)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (existing) {
    // Same key, different payload → reject
    if (existing.request_hash !== requestHash) {
      res.status(422).json({
        error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key reused with a different request body' },
      });
      return;
    }
    // Return the cached response
    res.status(200).json(existing.response_body);
    return;
  }

  // Intercept res.json so we can save the response after the handler runs
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    // Only cache successful order creations
    if (res.statusCode === 201) {
      adminDb.from('idempotency_keys').insert({
        customer_id: customerId,
        idempotency_key: key,
        request_hash: requestHash,
        response_body: body,
      }).then(() => {/* fire and forget */});
    }
    return originalJson(body);
  };

  next();
}
