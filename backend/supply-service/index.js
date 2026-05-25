const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const amqp = require('amqplib');

const {
    connect,
    Invoice,
    InvoiceItem,
    Order,
    OrderItem,
    getSettings,
    updateSettings,
    Op
} = require('./db');

const { generateOne } = require('./generator');
const deliveryWorker = require('./delivery.worker');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3004;
const RABBIT_URL =
    process.env.RABBIT_URL ||
    'amqp://user:password@rabbitmq:5672';

let pubChannel = null;

// ────────────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────────────

function verifyToken(req, res, next) {
    const auth = req.headers.authorization;

    if (!auth) {
        return res.status(401).json({
            error: 'Токен відсутній'
        });
    }

    const token = auth.split(' ')[1] || auth;

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(403).json({
            error: 'Невірний токен'
        });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).json({
                error: 'Доступ заборонено'
            });
        }

        next();
    };
}

// ────────────────────────────────────────────────────────
// RABBITMQ
// ────────────────────────────────────────────────────────

async function connectRabbit() {
    while (true) {
        try {
            const conn = await amqp.connect(RABBIT_URL);

            conn.on('error', err => {
                console.error('RabbitMQ error:', err.message);
            });

            conn.on('close', () => {
                console.log('RabbitMQ closed. reconnect...');
                pubChannel = null;
                setTimeout(connectRabbit, 3000);
            });

            pubChannel = await conn.createChannel();

            await pubChannel.assertExchange(
                'goods_exchange',
                'topic',
                { durable: false }
            );

            await pubChannel.assertExchange(
                'analytics_exchange',
                'topic',
                { durable: false }
            );

            console.log('Supply service connected to RabbitMQ');

            break;
        } catch (err) {
            console.log(
                'RabbitMQ not ready, retrying in 3s...',
                err.message
            );

            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

function publish(exchange, routingKey, data) {
    if (!pubChannel) return;

    pubChannel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(data))
    );
}

// ────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────

function todayPrefix(prefix) {
    const d = new Date();

    return `${prefix}-${d.getFullYear()}${String(
        d.getMonth() + 1
    ).padStart(2, '0')}${String(
        d.getDate()
    ).padStart(2, '0')}`;
}

async function nextOrderNumber() {
    const prefix = todayPrefix('ORD');

    const count = await Order.count({
        where: {
            number: {
                [Op.like]: `${prefix}%`
            }
        }
    });

    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

// ────────────────────────────────────────────────────────
// INVOICES
// ────────────────────────────────────────────────────────

app.get(
    '/invoices',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const where = {};

            if (req.query.status) {
                where.status = req.query.status;
            }

            const invoices = await Invoice.findAll({
                where,
                include: [
                    {
                        model: InvoiceItem,
                        as: 'items'
                    }
                ],
                order: [['createdAt', 'DESC']],
                limit: 200
            });

            res.json(invoices);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.get(
    '/invoices/:id',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const invoice = await Invoice.findByPk(
                req.params.id,
                {
                    include: [
                        {
                            model: InvoiceItem,
                            as: 'items'
                        }
                    ]
                }
            );

            if (!invoice) {
                return res.status(404).json({
                    error: 'Накладну не знайдено'
                });
            }

            res.json(invoice);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.put(
    '/invoices/:id',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const invoice = await Invoice.findByPk(
                req.params.id,
                {
                    include: [
                        {
                            model: InvoiceItem,
                            as: 'items'
                        }
                    ]
                }
            );

            if (!invoice) {
                return res.status(404).json({
                    error: 'Накладну не знайдено'
                });
            }

            if (invoice.status !== 'pending') {
                return res.status(400).json({
                    error:
                        'Можна редагувати лише pending накладні'
                });
            }

            if (Array.isArray(req.body.items)) {
                for (const patch of req.body.items) {
                    const item = invoice.items.find(
                        i => i.id === patch._id
                    );

                    if (!item) continue;

                    if (patch.actualQuantity !== undefined) {
                        item.actualQuantity =
                            Number(patch.actualQuantity);
                    }

                    if (patch.expiry) {
                        item.expiry = patch.expiry;
                    }

                    await item.save();
                }
            }

            if (req.body.note !== undefined) {
                invoice.note = req.body.note;
            }

            await invoice.save();

            res.json(invoice);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.post(
    '/invoices/:id/confirm',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const invoice = await Invoice.findByPk(
                req.params.id,
                {
                    include: [
                        {
                            model: InvoiceItem,
                            as: 'items'
                        }
                    ]
                }
            );

            if (!invoice) {
                return res.status(404).json({
                    error: 'Накладну не знайдено'
                });
            }

            if (invoice.status !== 'pending') {
                return res.status(400).json({
                    error: 'Накладну вже опрацьовано'
                });
            }

            if (Array.isArray(req.body?.items)) {
                for (const patch of req.body.items) {
                    const item = invoice.items.find(
                        i => i.id === patch._id
                    );

                    if (
                        item &&
                        patch.actualQuantity !== undefined
                    ) {
                        item.actualQuantity =
                            Number(patch.actualQuantity);

                        await item.save();
                    }
                }
            }

            for (const item of invoice.items) {
                const qty =
                    item.actualQuantity != null
                        ? item.actualQuantity
                        : item.expectedQuantity;

                if (!qty || qty <= 0) continue;

                const payload = {
                    name: item.name,
                    sku: item.sku,
                    category: item.category,
                    unit: item.unit,
                    expiry: item.expiry,
                    productionDate: item.productionDate,
                    quantity: qty,
                    supplier: invoice.supplier,
                    purchasePrice: item.purchasePrice,
                    defaultPrice: 0,
                    dateAdded: new Date()
                };

                publish(
                    'goods_exchange',
                    'product.new',
                    payload
                );

                publish(
                    'analytics_exchange',
                    'product.new',
                    payload
                );
            }

            invoice.status = 'received';
            invoice.receivedAt = new Date();
            invoice.receivedBy =
                req.user?.email || '';

            await invoice.save();

            res.json({
                status: 'ok',
                invoice
            });
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.post(
    '/invoices/:id/cancel',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const invoice = await Invoice.findByPk(
                req.params.id,
                { include: [{ model: InvoiceItem, as: 'items' }] }
            );

            if (!invoice) {
                return res.status(404).json({
                    error: 'Накладну не знайдено'
                });
            }

            if (invoice.status === 'received') {
                return res.status(400).json({
                    error: 'Прийняту накладну скасувати не можна'
                });
            }

            invoice.status = 'cancelled';
            await invoice.save();

            // Перечитуємо з items для консистентної відповіді фронту
            const fresh = await Invoice.findByPk(invoice.id, {
                include: [{ model: InvoiceItem, as: 'items' }]
            });
            res.json(fresh);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.post(
    '/invoices/generate',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const invoice = await generateOne({
                supplier: req.body?.supplier,
                note: req.body?.note,
                itemsCount: req.body?.itemsCount,
                token: (
                    req.headers.authorization || ''
                ).split(' ')[1]
            });

            res.status(201).json(invoice);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

// ────────────────────────────────────────────────────────
// ORDERS
// ────────────────────────────────────────────────────────

app.get(
    '/orders',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const where = {};

            if (req.query.status) {
                where.status = req.query.status;
            }

            const orders = await Order.findAll({
                where,
                include: [
                    {
                        model: OrderItem,
                        as: 'items'
                    }
                ],
                order: [['createdAt', 'DESC']],
                limit: 200
            });

            res.json(orders);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.post(
    '/orders',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const { supplier, note, items } =
                req.body || {};

            if (!supplier) {
                return res.status(400).json({
                    error: 'Вкажіть постачальника'
                });
            }

            if (
                !Array.isArray(items) ||
                items.length === 0
            ) {
                return res.status(400).json({
                    error: 'Додайте позиції'
                });
            }

            const settings = await getSettings();

            const allowed = new Set(
                (settings.perishableCategories || []).map(
                    c => c.name
                )
            );

            const cleanItems = items
                .map(it => ({
                    name: String(it.name || '').trim(),
                    sku: String(it.sku || '').trim(),
                    category: String(
                        it.category || ''
                    ).trim(),
                    unit: String(it.unit || 'шт.'),
                    quantity: Number(it.quantity) || 0,
                    note: String(it.note || '')
                }))
                .filter(
                    it =>
                        it.name &&
                        it.category &&
                        it.quantity > 0
                );

            const wrong = cleanItems.find(
                it => !allowed.has(it.category)
            );

            if (wrong) {
                return res.status(400).json({
                    error: `Категорія "${wrong.category}" не дозволена`
                });
            }

            const order = await Order.create(
                {
                    number: await nextOrderNumber(),
                    supplier: String(supplier).trim(),
                    note: note || '',
                    items: cleanItems,
                    createdBy:
                        req.user?.email || ''
                },
                {
                    include: [
                        {
                            model: OrderItem,
                            as: 'items'
                        }
                    ]
                }
            );

            res.status(201).json(order);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.get(
    '/orders/:id',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const order = await Order.findByPk(
                req.params.id,
                {
                    include: [
                        {
                            model: OrderItem,
                            as: 'items'
                        }
                    ]
                }
            );

            if (!order) {
                return res.status(404).json({
                    error: 'Замовлення не знайдено'
                });
            }

            res.json(order);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.put(
    '/orders/:id',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const order = await Order.findByPk(
                req.params.id,
                {
                    include: [
                        {
                            model: OrderItem,
                            as: 'items'
                        }
                    ]
                }
            );

            if (!order) {
                return res.status(404).json({
                    error: 'Замовлення не знайдено'
                });
            }

            if (
                req.body.status &&
                ['draft', 'sent', 'cancelled'].includes(
                    req.body.status
                )
            ) {
                order.status = req.body.status;

                if (
                    req.body.status === 'sent' &&
                    !order.sentAt
                ) {
                    order.sentAt = new Date();
                }
            }

            if (req.body.note !== undefined) {
                order.note = req.body.note;
            }

            if (req.body.supplier !== undefined) {
                order.supplier = req.body.supplier;
            }

            await order.save();

            res.json(order);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.delete(
    '/orders/:id',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const order = await Order.findByPk(
                req.params.id
            );

            if (!order) {
                return res.status(404).json({
                    error: 'Замовлення не знайдено'
                });
            }

            order.status = 'cancelled';

            await order.save();

            res.json({
                ok: true,
                order
            });
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.post(
    '/orders/:id/simulate-delivery',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const order = await Order.findByPk(
                req.params.id,
                {
                    include: [
                        {
                            model: OrderItem,
                            as: 'items'
                        }
                    ]
                }
            );

            if (!order) {
                return res.status(404).json({
                    error: 'Замовлення не знайдено'
                });
            }

            if (order.status !== 'sent') {
                return res.status(400).json({
                    error:
                        'Замовлення має бути sent'
                });
            }

            const invoice =
                await deliveryWorker.deliverOrder(
                    order
                );

            res.json({
                status: 'ok',
                order,
                invoice
            });
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

// ────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────

app.get(
    '/settings',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const settings =
                await getSettings();

            res.json(settings);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

app.put(
    '/settings',
    verifyToken,
    requireRole('admin'),
    async (req, res) => {
        try {
            const updated =
                await updateSettings(
                    req.body || {}
                );

            await rescheduleCron();

            res.json(updated);
        } catch (e) {
            res.status(500).json({
                error: e.message
            });
        }
    }
);

// ────────────────────────────────────────────────────────
// CRON
// ────────────────────────────────────────────────────────

let cronJob = null;

async function dailyGenerate() {
    try {
        const settings = await getSettings();

        const suppliers =
            settings.suppliers || [];

        for (const supplier of suppliers) {
            await generateOne({
                supplier,
                note:
                    'Щоденна автоматична поставка'
            });
        }

        console.log(
            `[supply] generated ${suppliers.length} invoices`
        );
    } catch (e) {
        console.error(
            '[supply] daily generation failed:',
            e.message
        );
    }
}

async function rescheduleCron() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }

    const settings =
        await getSettings();

    if (!settings.cronEnabled) {
        console.log('[supply] cron disabled');
        return;
    }

    const schedule =
        settings.cronSchedule ||
        '0 9 * * *';

    const valid =
        cron.validate(schedule);

    cronJob = cron.schedule(
        valid ? schedule : '0 9 * * *',
        dailyGenerate
    );

    console.log(
        '[supply] cron scheduled:',
        schedule
    );
}

// ────────────────────────────────────────────────────────
// START
// ────────────────────────────────────────────────────────

async function start() {
    try {
        await connect();

        await connectRabbit();

        await rescheduleCron();

        deliveryWorker.start();

        app.listen(PORT, () => {
            console.log(
                `Supply Service running on port ${PORT}`
            );
        });
    } catch (e) {
        console.error(
            'Supply service failed to start:',
            e
        );

        process.exit(1);
    }
}

start();