-- ============================================================================
-- StockPro :: INVENTORY SERVICE :: inventorydb
-- Реляційна схема (PostgreSQL): партії (REQ-2.2) та журнал операцій (REQ-3.3).
-- Джерело: backend/inventory-service/{inventory.model.js, operation.model.js}
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Перелічення ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_status') THEN
        CREATE TYPE inventory_status AS ENUM ('active', 'sold', 'written_off');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_type') THEN
        CREATE TYPE operation_type AS ENUM ('receive', 'sale', 'writeoff');
    END IF;
END$$;

-- ── Партії товару ─────────────────────────────────────────────────────────
-- product_id навмисне НЕ FK — у мікросервісах products у іншій БД.
-- За потреби (моноліт) увімкніть FK у 99_combined_schema.sql.
CREATE TABLE IF NOT EXISTS inventory_batches (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID,
    name             VARCHAR(255) NOT NULL,
    sku              VARCHAR(100) NOT NULL DEFAULT '',
    category         VARCHAR(100) NOT NULL DEFAULT 'інше',
    unit             VARCHAR(20)  NOT NULL DEFAULT 'шт.',
    expiry           DATE         NOT NULL,
    production_date  DATE,
    supplier         VARCHAR(255) NOT NULL DEFAULT '—',
    purchase_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
    default_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity         NUMERIC(12,3) NOT NULL DEFAULT 1,
    initial_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
    status           inventory_status NOT NULL DEFAULT 'active',
    discount_percent INTEGER       NOT NULL DEFAULT 0,
    discount_applied_at TIMESTAMPTZ,
    date_added       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_inv_purchase_price_nonneg CHECK (purchase_price   >= 0),
    CONSTRAINT chk_inv_default_price_nonneg  CHECK (default_price    >= 0),
    CONSTRAINT chk_inv_quantity_nonneg       CHECK (quantity         >= 0),
    CONSTRAINT chk_inv_initial_qty_nonneg    CHECK (initial_quantity >= 0),
    CONSTRAINT chk_inv_qty_le_initial        CHECK (quantity        <= initial_quantity),
    CONSTRAINT chk_inv_discount_range        CHECK (discount_percent BETWEEN 0 AND 100),

    -- Унікальність партії: name + expiry + supplier
    CONSTRAINT uq_inventory_batch UNIQUE (name, expiry, supplier)
);

CREATE INDEX IF NOT EXISTS idx_inv_status     ON inventory_batches (status);
CREATE INDEX IF NOT EXISTS idx_inv_expiry     ON inventory_batches (expiry);
CREATE INDEX IF NOT EXISTS idx_inv_product_id ON inventory_batches (product_id);
CREATE INDEX IF NOT EXISTS idx_inv_supplier   ON inventory_batches (supplier);
CREATE INDEX IF NOT EXISTS idx_inv_category   ON inventory_batches (category);

-- Якщо БД уже існує (стара структура без знижки) — додаємо без падіння
ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS discount_percent     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS discount_applied_at  TIMESTAMPTZ;

-- ── Журнал операцій (надходження / продаж / списання) ─────────────────────
-- Ідентифікатори користувача/товару/партії зберігаються як рядки,
-- бо вони можуть приходити з інших мікросервісів.
CREATE TABLE IF NOT EXISTS operations (
    id           BIGSERIAL    PRIMARY KEY,
    type         operation_type NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_op_timestamp        ON operations (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_op_user_email_ts    ON operations (user_email, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_op_type             ON operations (type);
CREATE INDEX IF NOT EXISTS idx_op_batch_id         ON operations (batch_id);
CREATE INDEX IF NOT EXISTS idx_op_product_id       ON operations (product_id);

-- REQ-3.5: повернення продажу касиром. Якщо БД уже піднята зі старою
-- структурою — додаємо колонки без падіння.
ALTER TABLE operations ADD COLUMN IF NOT EXISTS returned    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS returned_by VARCHAR(255) NOT NULL DEFAULT '';
