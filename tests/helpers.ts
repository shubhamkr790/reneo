// Test helpers: sign in test users and get JWT tokens.
// Uses fixed UUIDs from seed.sql so tests don't need to look up IDs.

import { supabase } from '../src/config/supabase.js';

export const SELLER_A_ID   = '00000000-0000-0000-0000-000000000001';
export const SELLER_B_ID   = '00000000-0000-0000-0000-000000000002';
export const CUSTOMER_ID   = '00000000-0000-0000-0000-000000000003';

export const PRODUCT_ID      = '00000000-0000-0000-0002-000000000001'; // 100 in stock
export const LAST_ITEM_ID    = '00000000-0000-0000-0002-000000000002'; // 1 in stock

export async function signIn(email: string, password = 'password123') {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Sign in failed for ${email}: ${error?.message}`);
  return data.session.access_token;
}

export async function getTokens() {
  const [sellerAToken, sellerBToken, customerToken] = await Promise.all([
    signIn('seller_a@test.com'),
    signIn('seller_b@test.com'),
    signIn('customer@test.com'),
  ]);
  return { sellerAToken, sellerBToken, customerToken };
}
