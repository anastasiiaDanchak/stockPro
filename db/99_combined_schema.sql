-- ============================================================================
-- StockPro :: COMBINED SCHEMA (single PostgreSQL database)
-- Якщо ви хочете тримати всю систему в одній БД, а сервіси розмежовувати
-- через PostgreSQL schemas (а не окремі БД як зараз у docker-compose).
--
-- Запуск:
--   psql -U postgres -d stockpro -f 99_combined_schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Схеми (по одній на мікросервіс) ───────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS product;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS expiration;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS supply;

-- ── Спільна функція оновлення updated_at ─────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  AUTH                                                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE auth.user_role AS ENUM ('admin', 'cashier', 'analyst');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS auth.users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          auth.user_role NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_email_lower CHECK (email = LOWER(email))
);
CREATE INDEX IF NOT EXISTS idx_auth_users_role ON auth.users (role);

DROP TRIGGER IF EXISTS trg_auth_users_updated_at ON auth.users;
CREATE TRIGGER trg_auth_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  PRODUCT                                                             ║
-- ╚══════════════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS product.products (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    sku           VARCHAR(100) NOT NULL UNIQUE,
    category      VARCHAR(100) NOT NULL,
    unit          VARCHAR(20)  NOT NULL DEFAULT 'шт.',
    default_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_price >= 0),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    description   TEXT         NOT NULL DEFAULT '',
    expiry        DATE,
    quantity      NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    date_added    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_products_category  ON product.products (category);
CREATE INDEX IF NOT EXISTS idx_product_products_is_active ON product.products (is_active);

DROP TRIGGER IF EXISTS trg_product_products_updated_at ON product.products;
CREATE TRIGGER trg_product_products_updated_at
    BEFORE UPDATE ON product.products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  INVENTORY                                                           ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_status') THEN
        CREATE TYPE inventory.inventory_status AS ENUM ('active', 'sold', 'written_off');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_type') THEN
        CREATE TYPE inventory.operation_type AS ENUM ('receive', 'sale', 'writeoff');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS inventory.inventory_batches (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- У моноліті можна увімкнути FK:
    product_id       UUID REFERENCES product.products(id) ON DELETE SET NULL,
    name             VARCHAR(255) NOT NULL,
    sku              VARCHAR(100) NOT NULL DEFAULT '',
    category         VARCHAR(100) NOT NULL DEFAULT 'інше',
    unit             VARCHAR(20)  NOT NULL DEFAULT 'шт.',
    expiry           DATE         NOT NULL,
    production_date  DATE,
    supplier         VARCHAR(255) NOT NULL DEFAULT '—',
    purchase_price   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    default_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_price >= 0),
    quantity         NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    initial_quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (initial_quantity >= 0),
    status           inventory.inventory_status NOT NULL DEFAULT 'active',
    date_added       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_inv_qty_le_initial CHECK (quantity <= initial_quantity),
    CONSTRAINT uq_inventory_batch UNIQUE (name, expiry, supplier)
);
CREATE INDEX IF NOT EXISTS idx_inv_status     ON inventory.inventory_batches (status);
CREATE INDEX IF NOT EXISTS idx_inv_expiry     ON inventory.inventory_batches (expiry);
CREATE INDEX IF NOT EXISTS idx_inv_product_id ON inventory.inventory_batches (product_id);

CREATE TABLE IF NOT EXISTS inventory.operations (
    id           BIGSERIAL    PRIMARY KEY,
    type         inventory.operation_type NOT NULL,
    timestamp    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    user_id      VARCHAR(64)  NOT NULL DEFAULT '',
    user_email   VARCHAR(255) NOT NULL DEFAULT '',
    user_role    VARCHAR(32)  NOT NULL DEFAULT '',
    product_id   VARCHAR(64)  NOT NULL DEFAULT '',
    product_name VARCHAR(255) NOT NULL DEFAULT '',
    sku          VARCHAR(100) NOT NULL DEFAULT '',
    category     VARCHAR(100) NOT NULL DEFAULT '',
    supplier     VARCHAR(255) NOT NULL DEFAULT '',
    batch_id     VARCHAR(64)  NOT NULL DEFAULT '',
    quantity     NUMERIC(12,3) NOT NULL DEFAULT 0,
    reason       TEXT          NOT NULL DEFAULT '',
    price        NUMERIC(12,2) NOT NULL DEFAULT 0,
    note         TEXT          NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_op_timestamp     ON inventory.operations (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_op_user_email_ts ON inventory.operations (user_email, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_op_type          ON inventory.operations (type);

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  EXPIRATION                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_severity') THEN
        CREATE TYPE expiration.notification_severity AS ENUM ('info', 'warning', 'critical', 'expired');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS expiration.expirations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  VARCHAR(64) NOT NULL UNIQUE,
    name        VARCHAR(255),
    expiry      DATE,
    diff_days   INTEGER,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expirations_expiry ON expiration.expirations (expiry);

CREATE TABLE IF NOT EXISTS expiration.notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  VARCHAR(64) NOT NULL,
    batch_id    VARCHAR(64) NOT NULL,
    name        VARCHAR(255),
    expiry      DATE,
    diff_days   INTEGER,
    severity    expiration.notification_severity NOT NULL DEFAULT 'info',
    message     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_expiration_notifications_batch_severity UNIQUE (batch_id, severity)
);
CREATE INDEX IF NOT EXISTS idx_expiration_notifications_active ON expiration.notifications (active);

CREATE TABLE IF NOT EXISTS expiration.notification_dismissals (
    notification_id UUID NOT NULL REFERENCES expiration.notifications(id) ON DELETE CASCADE,
    user_email      VARCHAR(255) NOT NULL,
    dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_email)
);

CREATE TABLE IF NOT EXISTS expiration.settings (
    key        VARCHAR(64) PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_expiration_settings_updated_at ON expiration.settings;
CREATE TRIGGER trg_expiration_settings_updated_at
    BEFORE UPDATE ON expiration.settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  ANALYTICS                                                           ║
-- ╚══════════════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS analytics.analytics_events (
    id           BIGSERIAL PRIMARY KEY,
    event_type   VARCHAR(64) NOT NULL,
    product_id   VARCHAR(64),
    product_name VARCHAR(255),
    sku          VARCHAR(100),
    category     VARCHAR(100),
    supplier     VARCHAR(255),
    reason       TEXT,
    quantity     NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evt_type_ts  ON analytics.analytics_events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evt_category ON analytics.analytics_events (category);
CREATE INDEX IF NOT EXISTS idx_evt_supplier ON analytics.analytics_events (supplier);

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  SUPPLY                                                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
        CREATE TYPE supply.invoice_status AS ENUM ('pending', 'received', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE supply.order_status AS ENUM ('draft', 'sent', 'delivered', 'received', 'cancelled');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS supply.invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number                VARCHAR(64) NOT NULL UNIQUE,
    supplier              VARCHAR(255) NOT NULL,
    status                supply.invoice_status NOT NULL DEFAULT 'pending',
    note                  TEXT NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at           TIMESTAMPTZ,
    received_by           VARCHAR(255) NOT NULL DEFAULT '',
    linked_order_id       UUID,
    linked_order_number   VARCHAR(64) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_supply_invoices_status_created
    ON supply.invoices (status, created_at DESC);

CREATE TABLE IF NOT EXISTS supply.invoice_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id        UUID NOT NULL REFERENCES supply.invoices(id) ON DELETE CASCADE,
    name              VARCHAR(255) NOT NULL,
    sku               VARCHAR(100) NOT NULL DEFAULT '',
    category          VARCHAR(100) NOT NULL DEFAULT 'інше',
    unit              VARCHAR(20)  NOT NULL DEFAULT 'шт.',
    expected_quantity NUMERIC(12,3) NOT NULL CHECK (expected_quantity >= 0),
    actual_quantity   NUMERIC(12,3) CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
    production_date   DATE,
    expiry            DATE NOT NULL,
    purchase_price    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_supply_invoice_items_invoice ON supply.invoice_items (invoice_id);

CREATE TABLE IF NOT EXISTS supply.orders (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number                VARCHAR(64) NOT NULL UNIQUE,
    supplier              VARCHAR(255) NOT NULL,
    status                supply.order_status NOT NULL DEFAULT 'draft',
    note                  TEXT NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at               TIMESTAMPTZ,
    delivered_at          TIMESTAMPTZ,
    created_by            VARCHAR(255) NOT NULL DEFAULT '',
    linked_invoice_id     UUID REFERENCES supply.invoices(id) ON DELETE SET NULL,
    linked_invoice_number VARCHAR(64) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_supply_orders_status_created
    ON supply.orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS supply.order_items (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id  UUID NOT NULL REFERENCES supply.orders(id) ON DELETE CASCADE,
    name      VARCHAR(255) NOT NULL,
    sku       VARCHAR(100) NOT NULL DEFAULT '',
    category  VARCHAR(100) NOT NULL,
    unit      VARCHAR(20) NOT NULL DEFAULT 'шт.',
    quantity  NUMERIC(12,3) NOT NULL CHECK (quantity >= 0),
    note      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_supply_order_items_order ON supply.order_items (order_id);

CREATE TABLE IF NOT EXISTS supply.settings (
    key        VARCHAR(64) PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_supply_settings_updated_at ON supply.settings;
CREATE TRIGGER trg_supply_settings_updated_at
    BEFORE UPDATE ON supply.settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Готово. Запуск разом:
--   psql -U postgres -d stockpro -f 99_combined_schema.sql
-- ============================================================================
