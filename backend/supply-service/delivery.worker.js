const { Order, Invoice, InvoiceItem, getSettings, Op } = require('./db');

const WORKER_INTERVAL_MS = Number(process.env.DELIVERY_WORKER_INTERVAL_MS || 30000); // 30с

function todayPrefix() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function nextInvoiceNumber() {
    const prefix = `INV-${todayPrefix()}`;
    const count = await Invoice.count({
    where: {
        number: {
            [Op.like]: `${prefix}%`
        }
    }
});

    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

// Робить «постачальника». На вхід — замовлення, на вихід — накладна,
// створена з тих самих позицій, expectedQuantity = quantity замовлення.
async function deliverOrder(order) {
    if (order.status !== 'sent') return null;
    if (order.linkedInvoiceId) return null; // вже створено

    const items = order.items.map(it => {
        // Реалістично: постачальник ставить термін придатності залежно від категорії.
        // Для швидкопсувних — коротший, для решти — довший.
        const today = new Date();
        const isPerishable = ['фрукти', 'овочі', 'випічка'].includes(it.category);
        const daysAhead = isPerishable
            ? 3 + Math.floor(Math.random() * 5)   // 3-7 днів
            : 14 + Math.floor(Math.random() * 30); // 14-44 дні
        const expiry = new Date(today.getTime() + daysAhead * 86400000);
        const productionDate = new Date(today.getTime() - Math.floor(Math.random() * 2) * 86400000);

        return {
            name: it.name,
            sku: it.sku || '',
            category: it.category,
            unit: it.unit,
            expectedQuantity: Number(it.quantity) || 0,
            actualQuantity: null,
            productionDate,
            expiry,
            purchasePrice: 0
        };
    });

    const number = await nextInvoiceNumber();
    const invoice = await Invoice.create(
    {
        number,
        supplier: order.supplier,
        items,
        note: `Доставка за замовленням ${order.number}`,
        linkedOrderId: order.id,
        linkedOrderNumber: order.number
    },
    {
        include: [{ model: InvoiceItem, as: 'items' }]
    }
);

    order.status = 'delivered';
    order.deliveredAt = new Date();
    order.linkedInvoiceId = invoice.id;
    order.linkedInvoiceNumber = invoice.number;
    await order.save();

    console.log(`[delivery] order ${order.number} → invoice ${invoice.number}`);
    return invoice;
}

// Періодичний скан: якщо autoDeliveryEnabled — конвертуємо sent → delivered
async function runScan() {
    try {
        const settings = await getSettings();
        if (!settings.autoDeliveryEnabled) return;
        const delayMs = Math.max(0, Number(settings.deliveryDelayMinutes) || 0) * 60000;
        const cutoff = new Date(Date.now() - delayMs);

        const candidates = await Order.findAll({
    where: {
        status: 'sent',
        sentAt: {
            [Op.lte]: cutoff
        },
        linkedInvoiceId: null
    },
    include: ['items'],
    limit: 20
});

        for (const o of candidates) {
            try { await deliverOrder(o); }
            catch (e) { console.error(`[delivery] error for ${o.number}:`, e.message); }
        }
    } catch (e) {
        console.error('[delivery] scan failed:', e.message);
    }
}

let timer = null;
function start() {
    if (timer) return;
    timer = setInterval(runScan, WORKER_INTERVAL_MS);
    console.log(`[delivery] worker started (interval ${WORKER_INTERVAL_MS}ms)`);
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { start, stop, deliverOrder, runScan };
