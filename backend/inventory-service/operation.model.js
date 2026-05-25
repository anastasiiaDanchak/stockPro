const { DataTypes } = require('sequelize');
const { sequelize } = require('./inventory.db');

// REQ-3.3: журнал операцій (`operations`)
const Operation = sequelize.define('Operation', {
    id:        { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    type:      {
        type: DataTypes.STRING, allowNull: false,
        validate: { isIn: [['receive', 'sale', 'writeoff']] }
    },
    timestamp: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    userId:    { type: DataTypes.STRING(64),  allowNull: false, defaultValue: '', field: 'user_id' },
    userEmail: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '', field: 'user_email' },
    userRole:  { type: DataTypes.STRING(32),  allowNull: false, defaultValue: '', field: 'user_role' },
    productId: { type: DataTypes.STRING(64),  allowNull: false, defaultValue: '', field: 'product_id' },
    productName:{ type: DataTypes.STRING(255), allowNull: false, defaultValue: '', field: 'product_name' },
    sku:       { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    category:  { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    supplier:  { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    batchId:   { type: DataTypes.STRING(64),  allowNull: false, defaultValue: '', field: 'batch_id' },
    quantity:  {
        type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 0,
        get() { const v = this.getDataValue('quantity'); return v === null ? 0 : Number(v); }
    },
    reason:    { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    price:     {
        type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0,
        get() { const v = this.getDataValue('price'); return v === null ? 0 : Number(v); }
    },
    note:      { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    // REQ-3.5: повернення продажу касиром. Замість того, щоб видаляти
    // оригінальну операцію, маркуємо її як повернену і повертаємо залишок.
    returned:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    returnedAt:  { type: DataTypes.DATE, field: 'returned_at' },
    returnedBy:  { type: DataTypes.STRING(255), field: 'returned_by', defaultValue: '' }
}, {
    tableName: 'operations',
    timestamps: false
});

Operation.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    return v;
};

module.exports = Operation;
