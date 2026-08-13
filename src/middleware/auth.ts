// Verifies the Bearer JWT from the Authorization header using Supabase Auth.
// On success, attaches `req.user` with id, role, and email.
// On failure, responds with 401.

import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase.js';
import { adminDb } from '../config/supabase.js';

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid Authorization header' } });
    return;
  }

  const token = authHeader.slice(7);

  // Validate token with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } });
    return;
  }

  // Fetch the role from profiles table
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role, email')
    .eq('id', user.id)
    .single();

  if (!profile) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'User profile not found' } });
    return;
  }

  req.user = { id: user.id, role: profile.role, email: profile.email };
  next();
}
