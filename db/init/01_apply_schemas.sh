#!/bin/bash
# Накатує схеми на щойно створені бази даних.
# Запускається postgres-entrypoint після 00_create_databases.sql.
set -e

SCHEMA_DIR="/docker-entrypoint-initdb.d/schemas"

apply() {
    local db="$1"
    local file="$2"
    echo ">>> applying $file to $db"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -f "$SCHEMA_DIR/$file"
}

apply authdb       01_auth_db.sql
apply productsdb   02_product_db.sql
apply inventorydb  03_inventory_db.sql
apply expirationdb 04_expiration_db.sql
apply analyticsdb  05_analytics_db.sql
apply supplydb     06_supply_db.sql

echo ">>> all schemas applied"

# ── Seed-дані (3 користувачі + каталог + партії на складі) ───────────────
# Окремий файл, бо містить \connect для перемикання між БД.
echo ">>> applying seed data"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -f "$SCHEMA_DIR/99_seed_data.sql"
echo ">>> seed data applied"
