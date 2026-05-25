const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { UniqueConstraintError } = require('sequelize');
const User = require('../models/user.model');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET not set');

const TOKEN_TTL = process.env.JWT_TTL || '1h';
const ROLES = ['admin', 'cashier', 'analyst'];

// ── Auth middleware ──────────────────────────────────────
function verifyToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Токен відсутній' });
    const token = auth.split(' ')[1] || auth;
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Невірний або прострочений токен' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостатньо прав' });
        }
        next();
    };
}

// REQ-1.2 / REQ-1.3: вхід — звірка хешу пароля + JWT з TTL
router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ message: 'Email та пароль обовʼязкові' });
    }

    const user = await User.findOne({
        where: { email: String(email).toLowerCase().trim() }
    });
    if (!user) return res.status(401).json({ message: 'Невірні облікові дані' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Невірні облікові дані' });

    const token = jwt.sign(
        { id: String(user.id), email: user.email, fullName: user.fullName || '', role: user.role },
        SECRET,
        { expiresIn: TOKEN_TTL }
    );

    res.json({
        token,
        role: user.role,
        email: user.email,
        fullName: user.fullName || '',
        id: String(user.id)
    });
});

// REQ-1.1: реєстрація користувача
const PUBLIC_ROLES = ['cashier', 'analyst'];

// REQ-1.4: вимоги до пароля
//   ≥ 8 символів, хоча б одна літера і хоча б одна цифра.
function validatePassword(pwd) {
    if (typeof pwd !== 'string') return 'Пароль повинен бути рядком';
    if (pwd.length < 8)          return 'Пароль повинен містити щонайменше 8 символів';
    if (!/[A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/.test(pwd)) return 'Пароль має містити хоча б одну літеру';
    if (!/\d/.test(pwd))         return 'Пароль має містити хоча б одну цифру';
    return null;
}

router.post('/register', async (req, res) => {
    try {
        const { email, password, role, fullName } = req.body || {};
        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Email, пароль і роль обовʼязкові' });
        }
        const pwErr = validatePassword(password);
        if (pwErr) return res.status(400).json({ error: pwErr });
        const cleanName = String(fullName || '').trim();
        if (!cleanName) {
            return res.status(400).json({ error: 'Імʼя користувача обовʼязкове' });
        }
        if (!ROLES.includes(role)) {
            return res.status(400).json({ error: `Роль повинна бути однією з: ${ROLES.join(', ')}` });
        }

        const total = await User.count();
        const isFirstUser = total === 0;

        // Спробуємо розшифрувати токен — щоб дізнатись, чи запит від адміна
        let actorRole = null;
        const auth = req.headers.authorization;
        if (auth) {
            try {
                const decoded = jwt.verify(auth.split(' ')[1] || auth, SECRET);
                actorRole = decoded.role;
            } catch {
                // ігноруємо — буде розцінено як публічний запит
            }
        }

        if (isFirstUser) {
            if (role !== 'admin') {
                return res.status(400).json({ error: 'Перший користувач у системі повинен мати роль admin' });
            }
        } else if (role === 'admin' && actorRole !== 'admin') {
            return res.status(403).json({ error: 'Створювати адміністраторів може лише існуючий адмін' });
        } else if (!PUBLIC_ROLES.includes(role) && actorRole !== 'admin') {
            return res.status(403).json({ error: 'Цю роль може призначити лише адміністратор' });
        }

        const normalizedEmail = String(email).toLowerCase().trim();
        const existing = await User.findOne({ where: { email: normalizedEmail } });
        if (existing) {
            return res.status(409).json({ error: 'Користувач з таким email вже існує' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({
            email: normalizedEmail,
            passwordHash,
            fullName: cleanName,
            role
        });
        res.status(201).json({
            id: String(user.id),
            email: user.email,
            fullName: user.fullName,
            role: user.role
        });
    } catch (e) {
        console.error('[auth/register] error:', e);
        if (e instanceof UniqueConstraintError) {
            return res.status(409).json({ error: 'Email вже існує' });
        }
        res.status(500).json({ error: e.message || 'Внутрішня помилка реєстрації' });
    }
});

// Список користувачів — лише адмін
router.get('/users', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const users = await User.findAll({ order: [['createdAt', 'ASC']] });
        res.json(users.map(u => ({
            id: String(u.id),
            email: u.email,
            fullName: u.fullName || '',
            role: u.role,
            createdAt: u.createdAt
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// REQ-1.5: видалення користувача (касира / аналітика) адміном.
// Адмін не може видалити сам себе. Видалити іншого адміна — також не можна.
router.delete('/users/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const id = req.params.id;
        if (!id) return res.status(400).json({ error: 'ID користувача обовʼязковий' });

        if (String(req.user.id) === String(id)) {
            return res.status(400).json({ error: 'Не можна видалити власний акаунт' });
        }

        const user = await User.findByPk(id);
        if (!user) return res.status(404).json({ error: 'Користувача не знайдено' });

        if (user.role === 'admin') {
            return res.status(403).json({
                error: 'Адміністраторів не можна видаляти через інтерфейс'
            });
        }

        await user.destroy();
        res.json({ status: 'deleted', id: String(id) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Перевірка токена
router.post('/verify', (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ valid: false, error: 'Токен відсутній' });
    try {
        const decoded = jwt.verify(token, SECRET);
        res.json({ valid: true, user: decoded });
    } catch (e) {
        res.status(401).json({ valid: false, error: e.message });
    }
});

router.get('/me', verifyToken, (req, res) => {
    res.json({
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName || '',
        role: req.user.role
    });
});

// Сід — створює тестових користувачів, якщо таблиця порожня
async function seedIfEmpty() {
    const total = await User.count();
    if (total > 0) return;
    // Паролі відповідають вимогам: ≥8 символів, літера + цифра.
    // Синхронізовано з 99_seed_data.sql
    const seed = [
        { email: 'petrenko.olena@gmail.com',  password: 'admin1234',   fullName: 'Олена Петренко',  role: 'admin'   },
        { email: 'kovalenko.ivan@gmail.com',   password: 'cashier1234', fullName: 'Іван Коваленко',  role: 'cashier' },
        { email: 'sydorenko.maria@gmail.com',  password: 'analyst1234', fullName: 'Марія Сидоренко', role: 'analyst' }
    ];
    for (const u of seed) {
        const passwordHash = await bcrypt.hash(u.password, 10);
        await User.create({ email: u.email, passwordHash, fullName: u.fullName, role: u.role });
    }
    console.log('Seeded default users:');
    console.log('  petrenko.olena@gmail.com  / admin1234');
    console.log('  kovalenko.ivan@gmail.com  / cashier1234');
    console.log('  sydorenko.maria@gmail.com / analyst1234');
}

module.exports = router;
module.exports.seedIfEmpty = seedIfEmpty;
