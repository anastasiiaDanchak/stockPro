const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

// REQ-5.x: журнал аналітичних подій
const AnalyticsEvent = sequelize.define('AnalyticsEvent', {
    id:         { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    eventType:  { type: DataTypes.STRING(64), allowNull: false, field: 'event_type' },
    productId:  { type: DataTypes.STRING(64), field: 'product_id' },
    productName:{ type: DataTypes.STRING(255), field: 'product_name' },
    sku:        { type: DataTypes.STRING(100) },
    category:   { type: DataTypes.STRING(100) },
    supplier:   { type: DataTypes.STRING(255) },
    reason:     { type: DataTypes.TEXT },
    quantity:   {
        type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 1,
        get() { const v = this.getDataValue('quantity'); return v === null ? 0 : Number(v); }
    },
    timestamp:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    tableName: 'analytics_events',
    timestamps: false
});

AnalyticsEvent.prototype.toJSON = function () {
    const v = { ...this.get() }; v._id = v.id; return v;
};

module.exports = AnalyticsEvent;
