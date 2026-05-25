-- Запускається ОДИН раз при першому старті postgres-контейнера.
-- Створює 6 баз даних — по одній на мікросервіс.
CREATE DATABASE authdb;
CREATE DATABASE productsdb;
CREATE DATABASE inventorydb;
CREATE DATABASE expirationdb;
CREATE DATABASE analyticsdb;
CREATE DATABASE supplydb;
