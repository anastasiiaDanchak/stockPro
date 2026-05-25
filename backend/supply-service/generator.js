const axios = require('axios');
const { Invoice, InvoiceItem, getSettings, Op } = require('./db');
const PRODUCT_URL = process.env.PRODUCT_URL || 'http://product-service:4003';

// Простий лічильник для номерів накладних протягом дня
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

function pickRandom(arr, n) {
    if (!arr || arr.length === 0) return [];
    const copy = [...arr];
    const out = [];
    while (out.length < n && copy.length) {
        const idx = Math.floor(Math.random() * copy.length);
        out.push(copy.splice(idx, 1)[0]);
    }
    return out;
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Витягуємо каталог номенклатури з product-service (для генерації)
async function fetchCatalog(token) {
    try {
        const res = await axios.get(`${PRODUCT_URL}/catalog?active=true`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        return res.data || [];
    } catch (e) {
        console.warn('[supply] не вдалося завантажити каталог:', e.message);
        return [];
    }
}

// Створює одну накладну з N випадкових позицій від випадкового постачальника
async function generateOne(opts = {}) {
    const settings = await getSettings();

    let supplier = opts.supplier;
    if (!supplier) {
        const suppliers = settings.suppliers || [];
        if (suppliers.length === 0) supplier = 'Невідомий постачальник';
        else supplier = suppliers[Math.floor(Math.random() * suppliers.length)];
    }

    const catalog = await fetchCatalog(opts.token);
    const sourceItems = catalog.length > 0 ? catalog : [
        // fallback демо-дані якщо каталог порожній
        { name: 'Мінеральна вода',   sku: 'FRT-001', category: 'мінеральна вода',  unit: 'шг',   defaultPrice: 35 },
        { name: 'Молоко',   sku: 'DRY-001', category: 'молочні', unit: 'шт.',  defaultPrice: 28 },
        { name: 'Шинка',    sku: 'BKR-001', category: 'М\'ясо та риба', unit: 'шт.',  defaultPrice: 22 }
    ];

    const itemsCount = opts.itemsCount || randomBetween(2, 5);
    const picked = pickRandom(sourceItems, itemsCount);

    const items = picked.map(p => {
        const isWeight = (p.unit === 'кг');
        const expectedQuantity = isWeight ? randomBetween(5, 30) : randomBetween(10, 50);
        const today = new Date();
        const productionDate = new Date(today.getTime() - randomBetween(0, 2) * 86400000);
        const expiry = new Date(today.getTime() + randomBetween(3, 30) * 86400000);
        return {
            name: p.name,
            sku:  p.sku || '',
            category: p.category || 'інше',
            unit: p.unit || 'шт.',
            expectedQuantity,
            actualQuantity: null,
            productionDate,
            expiry,
            purchasePrice: Number(p.defaultPrice || 0) * 0.7
        };
    });

    const number = await nextInvoiceNumber();
    const created = await Invoice.create(
    {
        number,
        supplier,
        items,
        note: opts.note || 'Автоматично згенерована накладна'
    },
    {
        include: [{ model: InvoiceItem, as: 'items' }]
    }
);

const invoice = await Invoice.findByPk(created.id, {
    include: [{ model: InvoiceItem, as: 'items' }]
});
    return invoice;
}

module.exports = { generateOne, fetchCatalog };
