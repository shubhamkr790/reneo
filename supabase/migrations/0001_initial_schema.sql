-- ============================================================
-- Migration 0001: Initial Schema
-- Reneo — multi-seller commerce platform
-- ============================================================

-- Enable UUID extension (already available in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('SELLER', 'CUSTOMER');
CREATE TYPE product_status AS ENUM ('ACTIVE', 'ARCHIVED', 'DRAFT');
CREATE TYPE order_status AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- ============================================================
-- PROFILES
-- Extends Supabase auth.users — one row per registered user.
-- id mirrors auth.uid() so RLS can compare without a join.
-- ============================================================

CREATE TABLE profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role      user_role NOT NULL,
  full_name TEXT      NOT NULL,
  email     TEXT      NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STORES
-- Each SELLER owns exactly one store.
-- ============================================================

CREATE TABLE stores (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id   UUID        NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PRODUCTS
-- Belongs to a store. price_minor is stored in the smallest
-- currency unit (e.g. 1 FCFA = 1 unit) to avoid float errors.
-- status=ARCHIVED is a soft-delete — data is preserved.
-- ============================================================

CREATE TABLE products (
  id          UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    UUID           NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT           NOT NULL,
  description TEXT,
  category    TEXT,
  price_minor BIGINT         NOT NULL CHECK (price_minor > 0),
  status      product_status NOT NULL DEFAULT 'ACTIVE',
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Full-text search: precomputed tsvector column, auto-updated by trigger.
ALTER TABLE products ADD COLUMN search_vector TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))
  ) STORED;

-- ============================================================
-- INVENTORY
-- One row per product, enforced by the UNIQUE constraint.
-- stock_qty may not go below zero (CHECK constraint).
-- ============================================================

CREATE TABLE inventory (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID    NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  stock_qty  INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0)
);

-- ============================================================
-- ORDERS
-- Customer places an order. total_minor is computed by the
-- server — the client never sends a price.
-- ============================================================

CREATE TABLE orders (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status       order_status NOT NULL DEFAULT 'PENDING',
  total_minor  BIGINT       NOT NULL CHECK (total_minor > 0),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORDER ITEMS
-- Snapshot of price at order time — we never re-read from
-- products.price_minor so historical orders stay accurate.
-- ============================================================

CREATE TABLE order_items (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id         UUID    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       UUID    NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor BIGINT  NOT NULL CHECK (unit_price_minor > 0)
);

-- ============================================================
-- IDEMPOTENCY KEYS
-- Prevents duplicate orders on double-click / network retry.
-- Keyed by (customer_id, idempotency_key).
-- ============================================================

CREATE TABLE idempotency_keys (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key TEXT        NOT NULL,
  request_hash    TEXT        NOT NULL,  -- SHA-256 of request body
  response_body   JSONB       NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE (customer_id, idempotency_key)
);

-- ============================================================
-- ORDER EVENTS
-- Append-only log. Committed in the same transaction as the
-- order, so an event is never orphaned if the server crashes.
-- ============================================================

CREATE TABLE order_events (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id   UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT        NOT NULL,  -- e.g. 'ORDER_CREATED'
  payload    JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Seller listing their own products
CREATE INDEX idx_products_store_id     ON products(store_id);

-- Filtered public browsing (status, price range)
CREATE INDEX idx_products_status_price ON products(status, price_minor);

-- Category filter
CREATE INDEX idx_products_category     ON products(category) WHERE category IS NOT NULL;

-- Full-text search
CREATE INDEX idx_products_search       ON products USING GIN(search_vector);

-- Customer order history
CREATE INDEX idx_orders_customer_id    ON orders(customer_id, created_at DESC);

-- Seller reads events for their orders
CREATE INDEX idx_order_events_order_id ON order_events(order_id);

-- Expire old idempotency keys
CREATE INDEX idx_idempotency_expires   ON idempotency_keys(expires_at);

-- ============================================================
-- updated_at trigger for products
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
