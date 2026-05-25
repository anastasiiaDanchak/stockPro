const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

// REQ-2.1: довідник номенклатури (таблиця `products`)
const Product = sequelize.define('Product', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:         { type: DataTypes.STRING(255), allowNull: false },
    sku:          { type: DataTypes.STRING(100), allowNull: false, unique: true },
    category:     { type: DataTypes.STRING(100), allowNull: false },
    unit:         { type: DataTypes.STRING(20),  allowNull: false, defaultValue: 'шт.' },
    defaultPrice: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'default_price',
        get() {
            const v = this.getDataValue('defaultPrice');
            return v === null ? 0 : Number(v);
        }
    },
    isActive:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    description: { type: DataTypes.TEXT,    allowNull: false, defaultValue: '' },
    // Backward-compatibility поля
    expiry: { type: DataTypes.DATEONLY },
    quantity: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: false,
        defaultValue: 0,
        get() {
            const v = this.getDataValue('quantity');
            return v === null ? 0 : Number(v);
        }
    },
    dateAdded: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'date_added' },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'updated_at' }
}, {
    tableName: 'products',
    timestamps: true,
    createdAt: 'dateAdded',
    updatedAt: 'updatedAt'
});

// Сумісність із Mongo-форматом (фронтенд + RabbitMQ-події використовують `_id`)
Product.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    return v;
};

module.exports = Product;
