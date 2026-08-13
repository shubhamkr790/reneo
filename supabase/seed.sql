-- ============================================================
-- Seed: test users, stores, products, and inventory
-- for running automated tests
-- ============================================================

-- NOTE: These are inserted via service role in tests.
-- In local dev, run after `supabase start`.

-- Test user IDs (fixed so tests can reference them)
-- seller_a: 00000000-0000-0000-0000-000000000001
-- seller_b: 00000000-0000-0000-0000-000000000002
-- customer: 00000000-0000-0000-0000-000000000003

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'seller_a@test.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'seller_b@test.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000003', 'customer@test.com', crypt('password123', gen_salt('bf')), NOW(), NOW(), NOW(), '{"provider":"email"}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, role, full_name, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'SELLER',   'Seller A',  'seller_a@test.com'),
  ('00000000-0000-0000-0000-000000000002', 'SELLER',   'Seller B',  'seller_b@test.com'),
  ('00000000-0000-0000-0000-000000000003', 'CUSTOMER', 'Customer',  'customer@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO stores (id, owner_id, name) VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Store A'),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000002', 'Store B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, store_id, name, description, category, price_minor, status) VALUES
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', 'Widget Alpha', 'A test product', 'electronics', 5000, 'ACTIVE'),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000001', 'Last Item',    'Only 1 in stock', 'clothing',    2000, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory (product_id, stock_qty) VALUES
  ('00000000-0000-0000-0002-000000000001', 100),
  ('00000000-0000-0000-0002-000000000002', 1)
ON CONFLICT (product_id) DO NOTHING;
