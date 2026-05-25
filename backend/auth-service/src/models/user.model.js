const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// Sequelize-модель таблиці `users` (PostgreSQL).
// Таблицю створює init-скрипт у /db/init/schemas/01_auth_db.sql,
// тут ми лише описуємо її для запитів.
const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        set(v) { this.setDataValue('email', String(v).toLowerCase().trim()); }
    },
    passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash'
    },
    fullName: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: '',
        field: 'full_name',
        set(v) { this.setDataValue('fullName', String(v ?? '').trim()); }
    },
    role: {
        // ENUM `user_role` створено в SQL — тут STRING із валідацією
        type: DataTypes.STRING,
        allowNull: false,
        validate: { isIn: [['admin', 'cashier', 'analyst']] }
    },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'updated_at' }
}, {
    tableName: 'users',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    underscored: true
});

// Сумісність із фронтендом, що очікує Mongo-формат — повертаємо `_id`.
User.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    return v;
};

module.exports = User;
