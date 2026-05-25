-- ============================================================================
-- StockPro :: EXPIRATION SERVICE :: expirationdb
-- Реляційна схема (PostgreSQL): сканування строків придатності,
-- сповіщення з рівнем критичності (REQ-4.x), налаштування.
-- Джерело: backend/expiration-service/db.js
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Перелічення ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_severity') THEN
        CREATE TYPE notification_severity AS ENUM ('info', 'warning', 'critical', 'expired');
    END IF;
END$$;

-- ── Останній скан кожної партії ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expirations (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  VARCHAR(64)  NOT NULL UNIQUE,   -- ObjectId партії з inventorydb
    name        VARCHAR(255),
    expiry      DATE,
    diff_days   INTEGER,                        -- різниця у днях до expiry (від'ємна = прострочено)
    checked_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expirations_expiry     ON expirations (expiry);
CREATE INDEX IF NOT EXISTS idx_expirations_checked_at ON expirations (checked_at DESC);

-- ── Сповіщення (REQ-4.2 / REQ-4.4) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  VARCHAR(64)  NOT NULL,
    batch_id    VARCHAR(64)  NOT NULL,
    name        VARCHAR(255),
    expiry      DATE,
    diff_days   INTEGER,
    severity    notification_severity NOT NULL DEFAULT 'info',
    message     TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    active      BOOLEAN      NOT NULL DEFAULT TRUE,

    -- Одне активне сповіщення на (партія, рівень)
    CONSTRAINT uq_notifications_batch_severity UNIQUE (batch_id, severity)
);

CREATE INDEX IF NOT EXISTS idx_notifications_active     ON notifications (active);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_product_id ON notifications (product_id);

-- ── Хто закрив сповіщення (заміна Mongo-масиву dismissedBy) ──────────────
CREATE TABLE IF NOT EXISTS notification_dismissals (
    notification_id UUID         NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_email      VARCHAR(255) NOT NULL,
    dismissed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notification_id, user_email)
);

CREATE INDEX IF NOT EXISTS idx_dismissals_user_email
    ON notification_dismissals (user_email);

-- ── Налаштування (REQ-4.1 / REQ-4.3) ──────────────────────────────────────
-- За замовчуванням: scanIntervalMinutes=60, thresholds: critical=3, warning=7, info=30
CREATE TABLE IF NOT EXISTS settings (
    key        VARCHAR(64)  PRIMARY KEY,
    value      JSONB        NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Тригер для updated_at
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
