-- ============================================================================
-- StockPro :: PRODUCT SERVICE :: productsdb
-- Реляційна схема (PostgreSQL) для довідника номенклатури (REQ-2.1).
-- Джерело: backend/product-service/product.model.js
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Товари (номенклатура) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(255) NOT NULL,
    sku           VARCHAR(100) NOT NULL UNIQUE,
    category      VARCHAR(100) NOT NULL,
    unit          VARCHAR(20)  NOT NULL DEFAULT 'шт.',
    default_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    description   TEXT         NOT NULL DEFAULT '',

    -- Backward-compatibility (легасі-поля з Mongoose-моделі)
    expiry        DATE,
    quantity      NUMERIC(12,3) NOT NULL DEFAULT 0,
    date_added    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_products_default_price_nonneg CHECK (default_price >= 0),
    CONSTRAINT chk_products_quantity_nonneg      CHECK (quantity      >= 0),
    CONSTRAINT chk_products_name_not_blank       CHECK (LENGTH(BTRIM(name)) > 0),
    CONSTRAINT chk_products_sku_not_blank        CHECK (LENGTH(BTRIM(sku))  > 0),
    CONSTRAINT chk_products_category_not_blank   CHECK (LENGTH(BTRIM(category)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_products_category   ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_is_active  ON products (is_active);
CREATE INDEX IF NOT EXISTS idx_products_date_added ON products (date_added DESC);

-- Тригер: оновлення updated_at (аналог pre('save'))
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
