// Auth routes: register and login
// These are thin — they delegate to Supabase Auth and create a profile row.

import { Router } from 'express';
import { z } from 'zod';
import { supabase, adminDb } from '../config/supabase.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const RegisterSchema = z.object({
  email:     z.string().email(),
  password:  z.string().min(8),
  full_name: z.string().min(1),
  role:      z.enum(['SELLER', 'CUSTOMER']),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
});

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const body = RegisterSchema.parse(req.body);

    // Create user in Supabase Auth
    const { data: { user }, error: signUpError } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
    });

    if (signUpError || !user) {
      throw new AppError(400, 'REGISTRATION_FAILED', signUpError?.message ?? 'Registration failed');
    }

    // Create profile row with role
    const { error: profileError } = await adminDb.from('profiles').insert({
      id:        user.id,
      role:      body.role,
      full_name: body.full_name,
      email:     body.email,
    });

    if (profileError) throw profileError;

    // If registering as a seller, create a store automatically
    if (body.role === 'SELLER') {
      await adminDb.from('stores').insert({
        owner_id:    user.id,
        name:        `${body.full_name}'s Store`,
        description: null,
      });
    }

    res.status(201).json({ message: 'Registration successful. Check your email to confirm.' });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const body = LoginSchema.parse(req.body);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error || !data.session) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    res.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in,
      user: {
        id:    data.user.id,
        email: data.user.email,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
