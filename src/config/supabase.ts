// Two Supabase clients:
// - `supabase`  → anon key, respects RLS. Used for auth verification.
// - `adminDb`   → service role key, bypasses RLS. Used for order creation
//                 transactions where we need to write across multiple tables.

import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

export const adminDb = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
