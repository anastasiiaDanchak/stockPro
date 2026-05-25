-- ============================================================================
-- StockPro :: ANALYTICS SERVICE :: analyticsdb
-- Реляційна схема (PostgreSQL): журнал аналітичних подій.
-- Джерело: backend/analytics-service/analytics.model.js
-- ============================================================================

-- ── Аналітичні події ──────────────────────────────────────────────────────
-- eventType: product.new | product.sold | product.writeoff | product.expired
-- Зберігаємо як VARCHAR (а не ENUM), щоб не ламати схему при додаванні нових
-- типів подій з мікросервісів через RabbitMQ.
CREATE TABLE IF NOT EXISTS analytics_events (
    id           BIGSERIAL    PRIMARY KEY,
    event_type   VARCHAR(64)  NOT NULL,
    product_id   VARCHAR(64),
    product_name VARCHAR(255),
    sku          VARCHAR(100),
    category     VARCHAR(100),
    supplier     VARCHAR(255),
    reason       TEXT,                          -- лише для product.writeoff
    quantity     NUMERIC(12,3) NOT NULL DEFAULT 1,
    timestamp    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_evt_quantity_nonneg CHECK (quantity >= 0)
);

CREATE INDEX IF NOT EXISTS idx_evt_type_ts   ON analytics_events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_evt_category  ON analytics_events (category);
CREATE INDEX IF NOT EXISTS idx_evt_supplier  ON analytics_events (supplier);
CREATE INDEX IF NOT EXISTS idx_evt_timestamp ON analytics_events (timestamp DESC);
