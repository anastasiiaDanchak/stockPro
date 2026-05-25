const express = require('express');
const amqp = require('amqplib');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Op, UniqueConstraintError } = require('sequelize');
const { connect } = require('./db');
const Product = require('./product.model');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4003;
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://user:password@rabbitmq:5672';

let channel;

// ── Auth helpers ─────────────────────────────────────────
function verifyToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Токен відсутній' });
    const token = auth.split(' ')[1] || auth;
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(403).json({ error: 'Невірний токен' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).json({ error: 'Доступ заборонено' });
        }
        next();
    };
}

// ── RabbitMQ ─────────────────────────────────────────────
async function connectRabbit() {
    while (true) {
        try {
            const conn = await amqp.connect(RABBIT_URL);
            conn.on('error', err => console.error('RabbitMQ error:', err.message));
            conn.on('close', () => {
                console.log('RabbitMQ closed, reconnecting...');
                channel = null;
                setTimeout(connectRabbit, 3000);
            });
            channel = await conn.createChannel();
            await channel.assertExchange('goods_exchange', 'topic', { durable: false });
            await channel.assertExchange('analytics_exchange', 'topic', { durable: false });
            console.log('Connected to RabbitMQ (product-service)');
            break;
        } catch {
            console.log('RabbitMQ not ready, retrying in 3s...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// ── REQ-2.1: Номенклатура — CRUD ─────────────────────────
app.get('/catalog', verifyToken, async (req, res) => {
    try {
        const { category, active } = req.query;
        const where = {};
        if (category) where.category = category;
        if (active === 'true')  where.isActive = true;
        if (active === 'false') where.isActive = false;
        const items = await Product.findAll({ where, order: [['name', 'ASC']] });
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Унікальні категорії (для фільтрів)
app.get('/categories', verifyToken, async (req, res) => {
    try {
        const rows = await Product.findAll({
            attributes: ['category'],
            group: ['category'],
            order: [['category', 'ASC']],
            raw: true
        });
        res.json(rows.map(r => r.category).filter(Boolean));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/catalog', verifyToken, requireRole('admin'), async (req, res) => {
    const { name, sku, category, unit, defaultPrice, description } = req.body || {};
    if (!name || !sku || !category) {
        return res.status(400).json({ error: 'Поля name, sku, category обовʼязкові' });
    }
    try {
        const item = await Product.create({
            name: String(name).trim(),
            sku:  String(sku).trim(),
            category: String(category).trim(),
            unit: unit || 'шт.',
            defaultPrice: Number(defaultPrice) || 0,
            description: description || '',
            isActive: true
        });
        res.status(201).json(item);
    } catch (e) {
        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({ error: 'Артикул (SKU) вже існує' });
        }
        res.status(500).json({ error: e.message });
    }
});

app.put('/catalog/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const update = {};
        ['name', 'sku', 'category', 'unit', 'description'].forEach(k => {
            if (req.body[k] !== undefined) update[k] = req.body[k];
        });
        if (req.body.defaultPrice !== undefined) update.defaultPrice = Number(req.body.defaultPrice);
        if (req.body.isActive     !== undefined) update.isActive     = !!req.body.isActive;
        update.updatedAt = new Date();

        const item = await Product.findByPk(req.params.id);
        if (!item) return res.status(404).json({ error: 'Позицію не знайдено' });
        await item.update(update);
        res.json(item);
    } catch (e) {
        if (e instanceof UniqueConstraintError) return res.status(409).json({ error: 'SKU вже існує' });
        res.status(500).json({ error: e.message });
    }
});

app.delete('/catalog/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const item = await Product.findByPk(req.params.id);
        if (!item) return res.status(404).json({ error: 'Позицію не знайдено' });
        await item.update({ isActive: false, updatedAt: new Date() });
        res.json({ status: 'deactivated', item });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── REQ-2.2: Прийом партії товару ────────────────────────
app.post('/add', verifyToken, requireRole('admin'), async (req, res) => {
    const {
        name, expiry, quantity,
        sku, category, unit, defaultPrice,
        productionDate, supplier, purchasePrice
    } = req.body;

    if (!name || !expiry) return res.status(400).json({ error: 'Заповніть всі поля' });
    const date = new Date(expiry);
    if (isNaN(date.getTime())) return res.status(400).json({ error: 'Невірний формат дати' });
    const qty = Number(quantity);
    if (!qty || qty < 1) return res.status(400).json({ error: 'Кількість повинна бути більше 0' });

    try {
        // Шукаємо номенклатуру за SKU або назвою
        let nomenclature = null;
        if (sku) nomenclature = await Product.findOne({ where: { sku: String(sku).trim() } });
        if (!nomenclature) nomenclature = await Product.findOne({ where: { name: String(name).trim() } });

        if (!nomenclature) {
            nomenclature = await Product.create({
                name: String(name).trim(),
                sku: sku ? String(sku).trim() : `AUTO-${Date.now()}`,
                category: category || 'інше',
                unit: unit || 'шт.',
                defaultPrice: Number(defaultPrice) || 0,
                expiry: date,
                quantity: qty
            });
        } else {
            await nomenclature.update({
                expiry: date,
                quantity: Number(nomenclature.quantity || 0) + qty
            });
        }

        // Подія для inventory-service та analytics-service
        if (channel) {
            const payload = Buffer.from(JSON.stringify({
                _id: nomenclature.id,
                name: nomenclature.name,
                sku: nomenclature.sku,
                category: nomenclature.category,
                unit: nomenclature.unit,
                defaultPrice: Number(nomenclature.defaultPrice),
                expiry: date,
                quantity: qty,
                productionDate: productionDate ? new Date(productionDate) : null,
                supplier: supplier || '—',
                purchasePrice: Number(purchasePrice) || 0,
                dateAdded: new Date()
            }));
            channel.publish('goods_exchange', 'product.new', payload);
            channel.publish('analytics_exchange', 'product.new', payload);
        }

        res.json({ status: 'Товар додано', product: nomenclature });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

async function start() {
    await connect();
    await connectRabbit();
    app.listen(PORT, () => console.log(`Product Service running on port ${PORT}`));
}

start();
