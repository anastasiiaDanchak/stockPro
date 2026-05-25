const axios = require('axios');
const amqp = require('amqplib');
const { Op } = require('sequelize');
const {
    Expiration, Notification, getSettings
} = require('./db');

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://user:password@rabbitmq:5672';
const INVENTORY_URL = process.env.INVENTORY_URL || 'http://inventory-service:3001/inventory';

let channel;

async function connectRabbit() {
    if (channel) return;
    try {
        const conn = await amqp.connect(RABBIT_URL);
        conn.on('error', err => console.error('RabbitMQ error:', err.message));
        conn.on('close', () => {
            channel = null;
            setTimeout(connectRabbit, 3000);
        });
        channel = await conn.createChannel();
        await channel.assertExchange('goods_exchange', 'topic', { durable: false });
        await channel.assertExchange('analytics_exchange', 'topic', { durable: false });
        console.log('Expiration service connected to RabbitMQ');
    } catch (err) {
        console.log('RabbitMQ not ready, retrying in 3s...');
        channel = null;
        setTimeout(connectRabbit, 3000);
    }
}

function publish(exchange, routingKey, msg) {
    if (channel) {
        channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(msg)));
    }
}

// REQ-4.2: рівень критичності за порогами
function severityFor(diffDays, thresholds) {
    if (diffDays < 0)                       return 'expired';
    if (diffDays <= thresholds.critical)    return 'critical';
    if (diffDays <= thresholds.warning)     return 'warning';
    if (diffDays <= thresholds.info)        return 'info';
    return null;
}

function messageFor(name, diffDays, severity) {
    if (severity === 'expired')  return `Товар "${name}" прострочено на ${Math.abs(diffDays)} дн.`;
    if (severity === 'critical') return `Термін придатності "${name}" завершується через ${diffDays} дн. (критично)`;
    if (severity === 'warning')  return `Термін придатності "${name}" завершується через ${diffDays} дн.`;
    if (severity === 'info')     return `"${name}" — наближається завершення терміну (${diffDays} дн.)`;
    return '';
}

async function checkExpirationsLogic() {
    const settings = await getSettings();
    const thresholds = settings.thresholds;

    const res = await axios.get(INVENTORY_URL, { headers: {} });
    const products = res.data;
    const now = Date.now();
    const result = { expired: [], critical: [], warning: [], info: [] };

    for (const p of products) {
        const productId = String(p._id || p.id);
        const expiryTS = new Date(p.expiry).getTime();
        const diffDays = Math.ceil((expiryTS - now) / 86400000);

        // upsert у Expiration
        await Expiration.upsert({
            productId,
            name: p.name,
            expiry: p.expiry,
            diffDays,
            checkedAt: new Date()
        });

        if (p.status && p.status !== 'active') continue;

        const severity = severityFor(diffDays, thresholds);
        if (!severity) continue;

        const message = messageFor(p.name, diffDays, severity);

        try {
            // Унікальний ключ (batch_id, severity) — використовуємо upsert
            const existing = await Notification.findOne({
                where: { batchId: productId, severity }
            });
            if (existing) {
                await existing.update({
                    productId: String(p.productId || productId),
                    name: p.name,
                    expiry: p.expiry,
                    diffDays,
                    message,
                    active: true
                });
            } else {
                await Notification.create({
                    productId: String(p.productId || productId),
                    batchId:   productId,
                    name:      p.name,
                    expiry:    p.expiry,
                    diffDays,
                    severity,
                    message,
                    active:    true
                });
            }
        } catch (e) {
            // ігноруємо колізії індексу
        }

        if (severity === 'expired') {
            publish('goods_exchange', 'product.expired', p);
            publish('analytics_exchange', 'product.expired', p);
            result.expired.push({ ...p, diffDays });
        } else if (severity === 'critical') {
            result.critical.push({ ...p, diffDays });
        } else if (severity === 'warning') {
            result.warning.push({ ...p, diffDays });
        } else if (severity === 'info') {
            result.info.push({ ...p, diffDays });
        }
    }

    const activeIds = products
        .filter(p => !p.status || p.status === 'active')
        .map(p => String(p._id || p.id));

    // Деактивуємо сповіщення для партій, яких більше немає у активних
    await Notification.update(
        { active: false },
        {
            where: activeIds.length > 0
                ? { batchId: { [Op.notIn]: activeIds } }
                : {}
        }
    );

    return {
        ...result,
        // зворотна сумісність зі старим інтерфейсом
        days10: result.critical,
        days20: result.warning,
        days30: result.info
    };
}

connectRabbit();

exports.checkExpirations = async () => {
    return await checkExpirationsLogic();
};
