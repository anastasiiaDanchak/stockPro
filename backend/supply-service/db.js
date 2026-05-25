const { Sequelize, DataTypes, Op } = require('sequelize');

const DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.MONGO_URL ||                       // зворотна сумісність
    'postgres://stockpro:stockpro@postgres:5432/supplydb';

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    define: { freezeTableName: true, timestamps: false }
});

async function connect() {
    while (true) {
        try {
            await sequelize.authenticate();
            console.log('Supply PostgreSQL connected');
            return;
        } catch (err) {
            console.log('Supply PostgreSQL not ready, retrying in 3s...', err.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// ── Накладна (вхідна — від постачальника) ────────────────
const Invoice = sequelize.define('Invoice', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:    { type: DataTypes.STRING(64), allowNull: false, unique: true },
    supplier:  { type: DataTypes.STRING(255), allowNull: false },
    status:    {
        type: DataTypes.STRING, allowNull: false, defaultValue: 'pending',
        validate: { isIn: [['pending', 'received', 'cancelled']] }
    },
    note:      { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    receivedAt:{ type: DataTypes.DATE, field: 'received_at' },
    receivedBy:{ type: DataTypes.STRING(255), allowNull: false, defaultValue: '', field: 'received_by' },
    linkedOrderId:     { type: DataTypes.UUID,        field: 'linked_order_id' },
    linkedOrderNumber: { type: DataTypes.STRING(64),  field: 'linked_order_number', defaultValue: '' }
}, { tableName: 'invoices', timestamps: false });

const InvoiceItem = sequelize.define('InvoiceItem', {
    id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    invoiceId:        { type: DataTypes.UUID, allowNull: false, field: 'invoice_id' },
    name:             { type: DataTypes.STRING(255), allowNull: false },
    sku:              { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    category:         { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'інше' },
    unit:             { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'шт.' },
    expectedQuantity: {
        type: DataTypes.DECIMAL(12, 3), allowNull: false, field: 'expected_quantity',
        get() { const v = this.getDataValue('expectedQuantity'); return v === null ? 0 : Number(v); }
    },
    actualQuantity:   {
        type: DataTypes.DECIMAL(12, 3), field: 'actual_quantity',
        get() { const v = this.getDataValue('actualQuantity'); return v === null ? null : Number(v); }
    },
    productionDate:   { type: DataTypes.DATEONLY, field: 'production_date' },
    expiry:           { type: DataTypes.DATEONLY, allowNull: false },
    purchasePrice:    {
        type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0, field: 'purchase_price',
        get() { const v = this.getDataValue('purchasePrice'); return v === null ? 0 : Number(v); }
    }
}, { tableName: 'invoice_items', timestamps: false });

Invoice.hasMany(InvoiceItem, { foreignKey: 'invoiceId', as: 'items', onDelete: 'CASCADE' });
InvoiceItem.belongsTo(Invoice, { foreignKey: 'invoiceId' });

// Сумісність: повертаємо `_id` + items[]
Invoice.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    if (v.items) v.items = v.items.map(it => (it.toJSON ? it.toJSON() : { ...it, _id: it.id }));
    return v;
};
InvoiceItem.prototype.toJSON = function () {
    const v = { ...this.get() }; v._id = v.id; return v;
};

// ── Замовлення на постачання ─────────────────────────────
const Order = sequelize.define('Order', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:    { type: DataTypes.STRING(64), allowNull: false, unique: true },
    supplier:  { type: DataTypes.STRING(255), allowNull: false },
    status:    {
        type: DataTypes.STRING, allowNull: false, defaultValue: 'draft',
        validate: { isIn: [['draft', 'sent', 'delivered', 'received', 'cancelled']] }
    },
    note:      { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    sentAt:      { type: DataTypes.DATE, field: 'sent_at' },
    deliveredAt: { type: DataTypes.DATE, field: 'delivered_at' },
    createdBy:   { type: DataTypes.STRING(255), allowNull: false, defaultValue: '', field: 'created_by' },
    linkedInvoiceId:     { type: DataTypes.UUID,       field: 'linked_invoice_id' },
    linkedInvoiceNumber: { type: DataTypes.STRING(64), field: 'linked_invoice_number', defaultValue: '' }
}, { tableName: 'orders', timestamps: false });

const OrderItem = sequelize.define('OrderItem', {
    id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    orderId:  { type: DataTypes.UUID, allowNull: false, field: 'order_id' },
    name:     { type: DataTypes.STRING(255), allowNull: false },
    sku:      { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    category: { type: DataTypes.STRING(100), allowNull: false },
    unit:     { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'шт.' },
    quantity: {
        type: DataTypes.DECIMAL(12, 3), allowNull: false,
        get() { const v = this.getDataValue('quantity'); return v === null ? 0 : Number(v); }
    },
    note:     { type: DataTypes.TEXT, allowNull: false, defaultValue: '' }
}, { tableName: 'order_items', timestamps: false });

Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });

Order.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    if (v.items) v.items = v.items.map(it => (it.toJSON ? it.toJSON() : { ...it, _id: it.id }));
    return v;
};
OrderItem.prototype.toJSON = function () {
    const v = { ...this.get() }; v._id = v.id; return v;
};

// ── Налаштування ─────────────────────────────────────────
const Settings = sequelize.define('Settings', {
    key:       { type: DataTypes.STRING(64), primaryKey: true },
    value:     { type: DataTypes.JSONB, allowNull: false },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'updated_at' }
}, { tableName: 'settings', timestamps: false });

// Замовлення дозволяються тільки на категорії, які адмін щодня поповнює:
// овочі та фрукти + випічка та хліб (короткий термін, неможливо запасати наперед).
const DEFAULT_SETTINGS = {
    cronEnabled: true,
    cronSchedule: '0 9 * * *',
    suppliers: ['ТОВ "Свіжі овочі"', 'ПП "Хлібзавод №1"', 'ФОП Петренко'],
    perishableCategories: [
        { name: 'овочі та фрукти', unit: 'кг'  },
        { name: 'випічка та хліб', unit: 'шт.' }
    ],
    autoDeliveryEnabled: true,
    deliveryDelayMinutes: 1
};

async function getSettings() {
    let doc = await Settings.findOne({ where: { key: 'supply' } });
    if (!doc) doc = await Settings.create({ key: 'supply', value: DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS, ...(doc.value || {}) };
}

async function updateSettings(patch) {
    const cur = await getSettings();
    const next = { ...cur, ...patch };
    await Settings.upsert({ key: 'supply', value: next, updatedAt: new Date() });
    return next;
}

module.exports = {
    sequelize, connect,
    Invoice, InvoiceItem, Order, OrderItem, Settings,
    getSettings, updateSettings, DEFAULT_SETTINGS,
    Op
};
