const { Sequelize, DataTypes, Op } = require('sequelize');

const DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgres://stockpro:stockpro@postgres:5432/expirationdb';

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    define: { freezeTableName: true, timestamps: false }
});

async function connect() {
    while (true) {
        try {
            await sequelize.authenticate();
            console.log('Expiration PostgreSQL connected');
            return;
        } catch (err) {
            console.log('Expiration PostgreSQL not ready, retrying in 3s...', err.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// ── Останній скан кожної партії ───────────────────────────────────────────
const Expiration = sequelize.define('Expiration', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    productId:  { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'product_id' },
    name:       { type: DataTypes.STRING(255) },
    expiry:     { type: DataTypes.DATEONLY },
    diffDays:   { type: DataTypes.INTEGER, field: 'diff_days' },
    checkedAt:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'checked_at' }
}, { tableName: 'expirations', timestamps: false });

// ── Сповіщення (REQ-4.2 / REQ-4.4) ───────────────────────────────────────
const Notification = sequelize.define('Notification', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    productId: { type: DataTypes.STRING(64), allowNull: false, field: 'product_id' },
    batchId:   { type: DataTypes.STRING(64), allowNull: false, field: 'batch_id' },
    name:      { type: DataTypes.STRING(255) },
    expiry:    { type: DataTypes.DATEONLY },
    diffDays:  { type: DataTypes.INTEGER, field: 'diff_days' },
    severity:  {
        type: DataTypes.STRING, allowNull: false, defaultValue: 'info',
        validate: { isIn: [['info', 'warning', 'critical', 'expired']] }
    },
    message:   { type: DataTypes.TEXT },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'created_at' },
    active:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: 'notifications', timestamps: false });

// ── Хто закрив сповіщення (заміна Mongo-масиву dismissedBy) ──────────────
const NotificationDismissal = sequelize.define('NotificationDismissal', {
    notificationId: {
        type: DataTypes.UUID, primaryKey: true, field: 'notification_id',
        references: { model: 'notifications', key: 'id' }
    },
    userEmail:    { type: DataTypes.STRING(255), primaryKey: true, field: 'user_email' },
    dismissedAt:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'dismissed_at' }
}, { tableName: 'notification_dismissals', timestamps: false });

Notification.hasMany(NotificationDismissal, { foreignKey: 'notificationId', as: 'dismissals' });
NotificationDismissal.belongsTo(Notification, { foreignKey: 'notificationId' });

// Сумісність: повертаємо `dismissedBy` як масив emails (як було в Mongo)
Notification.prototype.toJSON = function () {
    const v = { ...this.get() };
    v._id = v.id;
    v.dismissedBy = (v.dismissals || []).map(d => d.userEmail || d.user_email);
    delete v.dismissals;
    return v;
};

Expiration.prototype.toJSON = function () {
    const v = { ...this.get() }; v._id = v.id; return v;
};

// ── Settings ─────────────────────────────────────────────────────────────
const Settings = sequelize.define('Settings', {
    key:       { type: DataTypes.STRING(64), primaryKey: true },
    value:     { type: DataTypes.JSONB, allowNull: false },
    updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'updated_at' }
}, { tableName: 'settings', timestamps: false });

// Узгоджено з рівнями знижок: 30 / 20 / 10 днів = info / warning / critical.
// Важливо для одночасної гри сповіщень і кнопок «Застосувати −10/25/50%».
const DEFAULT_SETTINGS = {
    scanIntervalMinutes: 60,
    thresholds: { critical: 10, warning: 20, info: 30 }
};

async function getSettings() {
    let doc = await Settings.findOne({ where: { key: 'expiration' } });
    if (!doc) {
        doc = await Settings.create({ key: 'expiration', value: DEFAULT_SETTINGS });
    }
    return doc.value || DEFAULT_SETTINGS;
}

async function updateSettings(patch) {
    const current = await getSettings();
    const next = {
        scanIntervalMinutes: patch.scanIntervalMinutes ?? current.scanIntervalMinutes,
        thresholds: {
            critical: patch.thresholds?.critical ?? current.thresholds.critical,
            warning:  patch.thresholds?.warning  ?? current.thresholds.warning,
            info:     patch.thresholds?.info     ?? current.thresholds.info
        }
    };
    await Settings.upsert({ key: 'expiration', value: next, updatedAt: new Date() });
    return next;
}

module.exports = {
    sequelize,
    connect,
    Expiration,
    Notification,
    NotificationDismissal,
    Settings,
    getSettings,
    updateSettings,
    DEFAULT_SETTINGS,
    Op
};
