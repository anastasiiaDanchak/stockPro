const { DataTypes } = require('sequelize');
const { sequelize } = require('./inventory.db');

// REQ-2.2: партія товару (`inventory_batches`)
const Inventory = sequelize.define('Inventory', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    productId: { type: DataTypes.UUID, field: 'product_id' },
    name:      { type: DataTypes.STRING(255), allowNull: false },
    sku:       { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    category:  { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'інше' },
    unit:      { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'шт.' },
    expiry:         { type: DataTypes.DATEONLY, allowNull: false },
    productionDate: { type: DataTypes.DATEONLY, field: 'production_date' },
    supplier: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '—' },
    purchasePrice: {
        type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0,
        field: 'purchase_price',
        get() { const v = this.getDataValue('purchasePrice'); return v === null ? 0 : Number(v); }
    },
    defaultPrice: {
        type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0,
        field: 'default_price',
        get() { const v = this.getDataValue('defaultPrice'); return v === null ? 0 : Number(v); }
    },
    quantity: {
        type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 1,
        get() { const v = this.getDataValue('quantity'); return v === null ? 0 : Number(v); }
    },
    initialQuantity: {
        type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 1,
        field: 'initial_quantity',
        get() { const v = this.getDataValue('initialQuantity'); return v === null ? 0 : Number(v); }
    },
    status: {
        type: DataTypes.STRING, allowNull: false, defaultValue: 'active',
        validate: { isIn: [['active', 'sold', 'written_off']] }
    },
    // Знижка за наближенням терміну (REQ: 30/20/10 днів = 10/25/50%).
    // 0 = без знижки. Не застосовується автоматично до партій з категорій
    // які адмін замовляє (овочі-фрукти, випічка) — лише вручну.
    discountPercent: {
        type: DataTypes.INTEGER, allowNull: false, defaultValue: 0,
        field: 'discount_percent',
        validate: { min: 0, max: 100 }
    },
    discountAppliedAt: {
        type: DataTypes.DATE, field: 'discount_applied_at'
    },
    dateAdded: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'date_added' }
}, {
    tableName: 'inventory_batches',
    timestamps: false
});

// Сумісність із Mongo-форматом (фронтенд + події використовують `_id`)
Inventory.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    // Зручні обчислені поля для фронту
    const base = Number(v.defaultPrice) || 0;
    const dp   = Number(v.discountPercent) || 0;
    v.discountPercent = dp;
    v.salePrice = +(base * (1 - dp / 100)).toFixed(2);
    v.diffDays = Math.ceil((new Date(v.expiry).getTime() - Date.now()) / 86400000);
    return v;
};
// Аналог `item.toObject()` зі старого коду
Inventory.prototype.toObject = function () { return this.toJSON(); };

module.exports = Inventory;
