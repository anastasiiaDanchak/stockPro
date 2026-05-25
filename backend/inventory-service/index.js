require('./tracing');

const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
const jwt = require('jsonwebtoken');
const { connect } = require('./inventory.db');
const Inventory = require('./inventory.model');
const {
    addProduct, getProducts, sellProduct, writeoffProduct,
    getOperations, recordReceive, applyDiscount, returnSale
} = require('./inventory.controller');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const RABBIT_URL = process.env.RABBIT_URL || 'amqp://user:password@rabbitmq:5672';

let pubChannel;

// ── Auth ─────────────────────────────────────────────────
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

// ── RabbitMQ publisher ───────────────────────────────────
async function connectRabbitPublisher() {
    while (true) {
        try {
            const conn = await amqp.connect(RABBIT_URL);
            conn.on('error',  err => console.error('RabbitMQ publisher error:', err.message));
            conn.on('close', () => { pubChannel = null; setTimeout(connectRabbitPublisher, 3000); });
            pubChannel = await conn.createChannel();
            await pubChannel.assertExchange('analytics_exchange', 'topic', { durable: false });
            console.log('Inventory publisher connected to RabbitMQ');
            break;
        } catch {
            console.log('RabbitMQ publisher not ready, retrying in 3s...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

function publishEvent(routingKey, data) {
    if (pubChannel) {
        pubChannel.publish('analytics_exchange', routingKey, Buffer.from(JSON.stringify(data)));
    }
}

// ── Routes ───────────────────────────────────────────────
app.get('/inventory', async (req, res) => {
    try {
        const items = await getProducts({
            category:    req.query.category,
            supplier:    req.query.supplier,
            status:      req.query.status,
            expiryState: req.query.expiryState
        });
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Унікальні постачальники (для фільтрів)
app.get('/suppliers', async (req, res) => {
    try {
        const rows = await Inventory.findAll({
            attributes: ['supplier'],
            group: ['supplier'],
            order: [['supplier', 'ASC']],
            raw: true
        });
        res.json(rows.map(r => r.supplier).filter(Boolean));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/inventory', verifyToken, requireRole('admin'), async (req, res) => {
    const data = req.body || {};
    if (!data.name || !data.expiry) return res.status(400).json({ error: 'Заповніть всі поля' });
    const date = new Date(data.expiry);
    if (isNaN(date.getTime())) return res.status(400).json({ error: 'Невірний формат дати' });

    try {
        const product = await addProduct(data);
        if (!product) return res.status(409).json({ error: 'Така партія вже існує' });
        const qty = Number(data.quantity) || 1;
        await recordReceive(product, qty, req.user);
        publishEvent('product.new', { ...product.toJSON(), quantity: qty });
        res.status(201).json(product);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// REQ-3.1: продаж за FEFO
app.post('/sell', verifyToken, requireRole('cashier', 'admin'), async (req, res) => {
    const { productId, batchId, productName, quantity } = req.body;
    if (!productId && !batchId && !productName) {
        return res.status(400).json({ error: 'productId, batchId або productName обовʼязкові' });
    }
    try {
        const result = await sellProduct(
            { productId, batchId, productName, quantity },
            req.user
        );
        for (const u of result.items) {
            const batch = u.batch || u;
            const take  = u.take  || (Number(quantity) || 1);
            publishEvent('product.sold', {
                _id: String(batch.id),
                productId: String(batch.productId || ''),
                name: batch.name,
                sku: batch.sku,
                category: batch.category,
                supplier: batch.supplier,
                quantity: take
            });
        }
        res.json({
            status: 'Продано',
            soldQuantity: result.totalSold,
            batches: result.items.map(u => ({
                batchId: String((u.batch || u).id),
                taken:   u.take || (Number(quantity) || 1),
                expiry:  (u.batch || u).expiry
            }))
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// REQ-3.2: списання з причиною
app.post('/writeoff', verifyToken, requireRole('cashier', 'admin'), async (req, res) => {
    const { productId, batchId, quantity, reason, note } = req.body;
    if (!productId && !batchId) return res.status(400).json({ error: 'productId/batchId обовʼязкові' });
    try {
        const updated = await writeoffProduct({ productId, batchId, quantity, reason, note }, req.user);
        publishEvent('product.writeoff', {
            _id: String(updated.id),
            productId: String(updated.productId || ''),
            name: updated.name,
            sku: updated.sku,
            category: updated.category,
            supplier: updated.supplier,
            quantity: Number(quantity) || 1,
            reason: reason || 'other'
        });
        res.json({ status: 'Списано', product: updated });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// REQ-Discount: застосування знижки за наближенням терміну
// (30/20/10 днів = 10/25/50%). Тільки адмін.
app.post('/inventory/:id/discount', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const percent = Number(req.body?.percent ?? 0);
        const item = await applyDiscount(req.params.id, percent, req.user);
        publishEvent('product.discount', {
            _id: String(item.id),
            productId: String(item.productId || ''),
            name: item.name,
            sku: item.sku,
            category: item.category,
            supplier: item.supplier,
            discountPercent: item.discountPercent
        });
        res.json(item);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// REQ-3.5: повернення продажу касиром (або адміном).
// Бекенд перевіряє, що повертає автор операції; адмін може повертати будь-чию.
app.post('/operations/:id/return', verifyToken, requireRole('cashier', 'admin'), async (req, res) => {
    try {
        const updated = await returnSale(req.params.id, req.user);
        publishEvent('product.sale_returned', {
            _id: String(updated.id),
            batchId: updated.batchId,
            productName: updated.productName,
            quantity: Number(updated.quantity),
            returnedBy: updated.returnedBy,
            originalUserEmail: updated.userEmail
        });
        res.json({ status: 'returned', operation: updated });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// REQ-3.3 / REQ-3.4: журнал операцій
app.get('/operations', verifyToken, requireRole('cashier', 'admin', 'analyst'), async (req, res) => {
    try {
        const filter = {
            type:        req.query.type,
            productName: req.query.product,
            from:        req.query.from,
            to:          req.query.to,
            limit:       req.query.limit
        };
        if (req.user.role === 'cashier') {
            filter.userEmail = req.user.email;
        } else if (req.query.userEmail) {
            filter.userEmail = req.query.userEmail;
        }
        const ops = await getOperations(filter);
        res.json(ops);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Start ────────────────────────────────────────────────
(async () => {
    await connect();
    require('./inventory.consumer');   // консюмер старту тільки після БД
    connectRabbitPublisher();
    app.listen(PORT, () => console.log(`Inventory Service running on port ${PORT}`));
})();
