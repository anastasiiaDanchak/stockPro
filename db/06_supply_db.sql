-- ============================================================================
-- StockPro :: SUPPLY SERVICE :: supplydb
-- Реляційна схема (PostgreSQL): накладні (вхідні), замовлення (вихідні),
-- позиції накладних/замовлень, налаштування (cron, постачальники).
-- Джерело: backend/supply-service/db.js
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Перелічення статусів ──────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
        CREATE TYPE invoice_status AS ENUM ('pending', 'received', 'cancelled');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE order_status AS ENUM ('draft', 'sent', 'delivered', 'received', 'cancelled');
    END IF;
END$$;

-- ── Накладні (від постачальника) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number                VARCHAR(64)  NOT NULL UNIQUE,           -- INV-20260505-001
    supplier              VARCHAR(255) NOT NULL,
    status                invoice_status NOT NULL DEFAULT 'pending',
    note                  TEXT         NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    received_at           TIMESTAMPTZ,
    received_by           VARCHAR(255) NOT NULL DEFAULT '',
    linked_order_id       UUID,                                   -- м'яке посилання на orders.id
    linked_order_number   VARCHAR(64)  NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_invoices_status_created
    ON invoices (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices (supplier);

-- ── Позиції накладної ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id        UUID         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    name              VARCHAR(255) NOT NULL,
    sku               VARCHAR(100) NOT NULL DEFAULT '',
    category          VARCHAR(100) NOT NULL DEFAULT 'інше',
    unit              VARCHAR(20)  NOT NULL DEFAULT 'шт.',         -- 'шт.' або 'кг'
    expected_quantity NUMERIC(12,3) NOT NULL,
    actual_quantity   NUMERIC(12,3),                               -- NULL поки не звірено
    production_date   DATE,
    expiry            DATE         NOT NULL,
    purchase_price    NUMERIC(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT chk_invitm_expected_nonneg  CHECK (expected_quantity >= 0),
    CONSTRAINT chk_invitm_actual_nonneg    CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
    CONSTRAINT chk_invitm_purchase_nonneg  CHECK (purchase_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);

-- ── Замовлення (наші — постачальнику) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number                VARCHAR(64)  NOT NULL UNIQUE,           -- ORD-20260505-001
    supplier              VARCHAR(255) NOT NULL,
    status                order_status NOT NULL DEFAULT 'draft',
    note                  TEXT         NOT NULL DEFAULT '',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    sent_at               TIMESTAMPTZ,
    delivered_at          TIMESTAMPTZ,
    created_by            VARCHAR(255) NOT NULL DEFAULT '',
    linked_invoice_id     UUID,
    linked_invoice_number VARCHAR(64)  NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created
    ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders (supplier);

-- ── Позиції замовлення ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id  UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    name      VARCHAR(255) NOT NULL,
    sku       VARCHAR(100) NOT NULL DEFAULT '',
    category  VARCHAR(100) NOT NULL,
    unit      VARCHAR(20)  NOT NULL DEFAULT 'шт.',
    quantity  NUMERIC(12,3) NOT NULL,
    note      TEXT         NOT NULL DEFAULT '',

    CONSTRAINT chk_orditm_quantity_nonneg CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- ── Налаштування (cron, перелік постачальників, швидкопсувні категорії) ──
CREATE TABLE IF NOT EXISTS settings (
    key        VARCHAR(64) PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
