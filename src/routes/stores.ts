// Store routes — seller manages their store profile.

import { Router } from 'express';
import { z } from 'zod';
import { adminDb } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const UpdateStoreSchema = z.object({
  name:        z.string().min(1).optional(),
  description: z.string().optional(),
});

// GET /stores/me — seller views their own store
router.get('/me', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const { data, error } = await adminDb
      .from('stores')
      .select('*')
      .eq('owner_id', req.user!.id)
      .single();

    if (error || !data) throw new AppError(404, 'NOT_FOUND', 'Store not found');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /stores/me — seller updates their store
router.patch('/me', authenticate, requireRole('SELLER'), async (req, res, next) => {
  try {
    const body = UpdateStoreSchema.parse(req.body);

    const { data, error } = await adminDb
      .from('stores')
      .update(body)
      .eq('owner_id', req.user!.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /stores — public: list all stores
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await adminDb.from('stores').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
