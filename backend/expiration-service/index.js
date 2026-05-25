require('./tracing');
const dbModule = require('./db');

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { checkExpirations } = require('./checker');
const {
    connect, Notification, NotificationDismissal,
    getSettings, updateSettings
} = dbModule;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3003;

// ── Auth middleware ──────────────────────────────────────
function verifyToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Токен відсутній' });
    const token = auth.split(' ')[1] || auth;
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(403).json({ error: 'Невірний токен' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) {
            return res.status(403).json({ error: 'Доступ заборонено' });
        }
        next();
    };
}

// REQ-4.1: ручний запуск перевірки
app.get('/check', async (req, res) => {
    try {
        const result = await checkExpirations();
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// REQ-4.4: активні сповіщення
app.get('/notifications', async (req, res) => {
    try {
        const { severity } = req.query;
        const where = { active: true };
        if (severity) where.severity = severity;
        const items = await Notification.findAll({
            where,
            include: [{ model: NotificationDismissal, as: 'dismissals' }],
            order: [['diffDays', 'ASC'], ['createdAt', 'DESC']]
        });
        res.json(items);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Закрити сповіщення (для конкретного користувача)
app.post('/notifications/:id/dismiss', verifyToken, async (req, res) => {
    try {
        const n = await Notification.findByPk(req.params.id);
        if (!n) return res.status(404).json({ error: 'Сповіщення не знайдено' });
        // Insert-or-ignore: PK = (notificationId, userEmail)
        try {
            await NotificationDismissal.create({
                notificationId: n.id,
                userEmail: req.user.email
            });
        } catch (e) {
            // вже є — ігноруємо
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// REQ-4.3: налаштування — прочитати
app.get('/settings', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        res.json(await getSettings());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// REQ-4.3: налаштування — оновити
app.put('/settings', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const updated = await updateSettings(req.body || {});
        rescheduleScan();
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── REQ-4.1: періодичний скан ────────────────────────────
let scanTimer = null;

async function rescheduleScan() {
    if (scanTimer) clearInterval(scanTimer);
    const settings = await getSettings().catch(() => ({ scanIntervalMinutes: 60 }));
    const intervalMs = Math.max(1, Number(settings.scanIntervalMinutes) || 60) * 60 * 1000;
    console.log(`[Expiration] scan interval = ${settings.scanIntervalMinutes} min`);
    scanTimer = setInterval(async () => {
        try {
            const r = await checkExpirations();
            console.log('[Expiration] scheduled scan complete:',
                'expired=', r.expired.length,
                'critical=', r.critical.length,
                'warning=', r.warning.length);
        } catch (e) {
            console.error('[Expiration] scheduled scan failed:', e.message);
        }
    }, intervalMs);
}

(async () => {
    await connect();
    setTimeout(async () => {
        try { await checkExpirations(); } catch {}
        rescheduleScan();
    }, 30000);
    app.listen(PORT, () => console.log(`Expiration Service running on port ${PORT}`));
})();
