# StockPro — реляційна схема БД (PostgreSQL)

Згенеровано на основі Mongoose-моделей з `backend/*/`. Зберігає поділ на мікросервіси: **6 окремих БД** (по одній на сервіс), плюс додатковий монолітний варіант через PostgreSQL `SCHEMA`.

## Файли

| Файл | БД / схема | Що містить |
|---|---|---|
| `01_auth_db.sql` | `authdb` | `users`, ENUM `user_role`, тригер `updated_at` |
| `02_product_db.sql` | `productsdb` | `products` (довідник номенклатури) |
| `03_inventory_db.sql` | `inventorydb` | `inventory_batches` (партії), `operations` (журнал), 2 ENUM |
| `04_expiration_db.sql` | `expirationdb` | `expirations`, `notifications`, `notification_dismissals`, `settings` |
| `05_analytics_db.sql` | `analyticsdb` | `analytics_events` |
| `06_supply_db.sql` | `supplydb` | `invoices`/`invoice_items`, `orders`/`order_items`, `settings` |
| `99_combined_schema.sql` | одна БД, 6 schemas | Усе разом + м'які FK між схемами |
| `init/schemas/99_seed_data.sql` | усі БД | Тестові дані (користувачі, каталог, партії з різними термінами) |

## Як запустити (мікросервісний варіант — як у docker-compose)

Створіть 6 окремих БД та запустіть відповідні файли:

```bash
for svc in auth product inventory expiration analytics supply; do
  createdb -U postgres "${svc}db"
done

psql -U postgres -d authdb       -f 01_auth_db.sql
psql -U postgres -d productsdb   -f 02_product_db.sql
psql -U postgres -d inventorydb  -f 03_inventory_db.sql
psql -U postgres -d expirationdb -f 04_expiration_db.sql
psql -U postgres -d analyticsdb  -f 05_analytics_db.sql
psql -U postgres -d supplydb     -f 06_supply_db.sql
```

## Як запустити (моноліт — одна БД, 6 schemas)

```bash
createdb -U postgres stockpro
psql -U postgres -d stockpro -f 99_combined_schema.sql
```

## Ключові рішення мапінгу Mongo → SQL

- **`ObjectId` → `UUID`** з `gen_random_uuid()` (`pgcrypto`).
- **Mongoose `enum`** → нативний PostgreSQL `ENUM TYPE`.
- **`Mixed` (settings.value)** → `JSONB` (зберігає вкладену структуру з порогами / cron).
- **Embedded array `items[]`** (накладні, замовлення) → окремі таблиці `invoice_items`/`order_items` з FK + `ON DELETE CASCADE`.
- **Array `dismissedBy: [String]`** → таблиця зв'язку `notification_dismissals (notification_id, user_email)`.
- **Унікальний композитний індекс на партію** `(name, expiry, supplier)` → `UNIQUE` constraint.
- **`pre('save')` оновлення `updatedAt`** → BEFORE UPDATE тригер `set_updated_at()`.
- **Cross-service ID** (`productId`, `batchId`, `userId`) у мікросервісних файлах залишені як `VARCHAR/UUID` **без FK**, бо живуть в інших БД. У `99_combined_schema.sql` додані справжні FK (де доречно).
- **Чекови `min: 0`** → `CHECK (... >= 0)`.

## Зв'язки (моноліт-варіант)

```
auth.users
    └─ (м'яке) operations.user_email / user_id        — журнал дій

product.products
    └─ inventory.inventory_batches.product_id  (FK)   — партії товару

inventory.inventory_batches  ←──────── (м'яке через batch_id)  inventory.operations

expiration.notifications  ──┬──────── notification_dismissals  (FK CASCADE)
                            └──────── (м'яке) inventory_batches  через batch_id

supply.invoices  ──── (FK CASCADE) ───── supply.invoice_items
supply.orders    ──── (FK CASCADE) ───── supply.order_items
supply.invoices ←──── linked_invoice_id  ───── supply.orders
```

## Що НЕ зберігається в БД

- Повідомлення RabbitMQ (`goods_exchange`, `analytics_exchange`) — це шина подій, а не сховище.
- JWT-токени — генеруються/перевіряються in-memory сервісом auth.
- Трейси Jaeger — окрема система спостережуваності.

## Розширення за потреби

- Додати soft-delete (`deleted_at TIMESTAMPTZ`) на `users`, `products`, `inventory_batches`.
- Партиціонування `analytics_events` та `operations` за `timestamp` (RANGE) — для великих обсягів.
- Матеріалізовані view для аналітичних запитів (за категоріями/постачальниками).
