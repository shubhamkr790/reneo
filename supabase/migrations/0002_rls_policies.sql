-- ============================================================
-- Migration 0002: Row Level Security Policies
-- ============================================================
-- IMPORTANT: These policies are the enforcement layer.
-- A hidden button is NOT access control — the DB rejects it.
-- ============================================================

-- ============================================================
-- PROFILES
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read and update their own profile
CREATE POLICY "profiles: owner access"
  ON profiles FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- STORES
-- ============================================================

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

-- Anyone can read stores
CREATE POLICY "stores: public read"
  ON stores FOR SELECT
  USING (true);

-- Only the owner can insert/update/delete their store
CREATE POLICY "stores: owner write"
  ON stores FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- PRODUCTS
-- ============================================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Anyone can read ACTIVE products
CREATE POLICY "products: public read active"
  ON products FOR SELECT
  USING (status = 'ACTIVE');

-- Sellers can read all their own products (including drafts/archived)
CREATE POLICY "products: seller read own"
  ON products FOR SELECT
  USING (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
  );

-- Sellers can only write to their own store's products
CREATE POLICY "products: seller write own"
  ON products FOR INSERT
  WITH CHECK (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
  );

CREATE POLICY "products: seller update own"
  ON products FOR UPDATE
  USING (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
  );

CREATE POLICY "products: seller delete own"
  ON products FOR DELETE
  USING (
    store_id IN (SELECT id FROM stores WHERE owner_id = auth.uid())
  );

-- ============================================================
-- INVENTORY
-- ============================================================

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

-- Anyone can read inventory (for availability checks)
CREATE POLICY "inventory: public read"
  ON inventory FOR SELECT
  USING (true);

-- Only the seller who owns the product can update inventory
CREATE POLICY "inventory: seller write own"
  ON inventory FOR ALL
  USING (
    product_id IN (
      SELECT p.id FROM products p
      JOIN stores s ON s.id = p.store_id
      WHERE s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    product_id IN (
      SELECT p.id FROM products p
      JOIN stores s ON s.id = p.store_id
      WHERE s.owner_id = auth.uid()
    )
  );

-- ============================================================
-- ORDERS
-- ============================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Customers see only their own orders
CREATE POLICY "orders: customer read own"
  ON orders FOR SELECT
  USING (customer_id = auth.uid());

-- Sellers can read orders that contain their products
CREATE POLICY "orders: seller read relevant"
  ON orders FOR SELECT
  USING (
    id IN (
      SELECT oi.order_id FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN stores s ON s.id = p.store_id
      WHERE s.owner_id = auth.uid()
    )
  );

-- Only customers (backend service role) can insert orders
CREATE POLICY "orders: customer insert"
  ON orders FOR INSERT
  WITH CHECK (customer_id = auth.uid());

-- ============================================================
-- ORDER ITEMS
-- ============================================================

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Customers see items on their own orders
CREATE POLICY "order_items: customer read own"
  ON order_items FOR SELECT
  USING (
    order_id IN (SELECT id FROM orders WHERE customer_id = auth.uid())
  );

-- Sellers see items on orders containing their products
CREATE POLICY "order_items: seller read relevant"
  ON order_items FOR SELECT
  USING (
    product_id IN (
      SELECT p.id FROM products p
      JOIN stores s ON s.id = p.store_id
      WHERE s.owner_id = auth.uid()
    )
  );

-- Insert handled by backend with service role
CREATE POLICY "order_items: backend insert"
  ON order_items FOR INSERT
  WITH CHECK (
    order_id IN (SELECT id FROM orders WHERE customer_id = auth.uid())
  );

-- ============================================================
-- IDEMPOTENCY KEYS
-- ============================================================

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Customers can only access their own idempotency keys
CREATE POLICY "idempotency_keys: customer own"
  ON idempotency_keys FOR ALL
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- ============================================================
-- ORDER EVENTS
-- ============================================================

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;

-- Sellers can read events for orders containing their products
CREATE POLICY "order_events: seller read"
  ON order_events FOR SELECT
  USING (
    order_id IN (
      SELECT oi.order_id FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      JOIN stores s ON s.id = p.store_id
      WHERE s.owner_id = auth.uid()
    )
  );

-- Events are inserted by the backend (service role bypasses RLS)
-- No insert policy needed for anon/user roles.
