const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());

const AUTH_URL       = process.env.AUTH_URL       || 'http://localhost:4001';
const INVENTORY_URL  = process.env.INVENTORY_URL  || 'http://localhost:3001';
const PRODUCT_URL    = process.env.PRODUCT_URL    || 'http://localhost:4003';
const ANALYTICS_URL  = process.env.ANALYTICS_URL  || 'http://localhost:3002';
const EXPIRATION_URL = process.env.EXPIRATION_URL || 'http://localhost:3003';
const SUPPLY_URL     = process.env.SUPPLY_URL     || 'http://localhost:3004';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.warn('[API Gateway] WARNING: JWT_SECRET is not set, JWT verification disabled');
}

// REQ-1.4 / REQ-1.5: Перевірка JWT-токена для захищених маршрутів.
// Шляхи /auth/login, /auth/register та /auth/verify публічні.
const PUBLIC_PATHS = [
    /^\/auth\/login\/?$/,
    /^\/auth\/register\/?$/,
    /^\/auth\/verify\/?$/
];

function isPublic(reqPath) {
    return PUBLIC_PATHS.some(re => re.test(reqPath));
}

function gatewayAuth(req, res, next) {
    if (!JWT_SECRET) return next();
    if (isPublic(req.path)) return next();

    const auth = req.headers.authorization;
    if (!auth) {
        return res.status(401).json({ error: 'Authorization header is missing' });
    }
    const parts = auth.split(' ');
    const token = parts.length === 2 ? parts[1] : parts[0];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        // Прокидаємо інформацію про користувача нижче (опціонально для сервісів)
        req.headers['x-user-id'] = String(decoded.id || '');
        req.headers['x-user-email'] = decoded.email || '';
        req.headers['x-user-role'] = decoded.role || '';
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

app.use(gatewayAuth);

// У http-proxy-middleware v3 Express вже знімає mount-префікс із req.url,
// тому додатковий pathRewrite не потрібен (і ламав /inventory/inventory).
const proxy = (target) =>
    createProxyMiddleware({
        target,
        changeOrigin: true
    });

app.use('/auth',       proxy(AUTH_URL));
app.use('/inventory',  proxy(INVENTORY_URL));
app.use('/products',   proxy(PRODUCT_URL));
app.use('/analytics',  proxy(ANALYTICS_URL));
app.use('/expiration', proxy(EXPIRATION_URL));
app.use('/supply',     proxy(SUPPLY_URL));

// Глобальний обробник помилок
app.use((err, req, res, next) => {
    console.error('[API Gateway] error:', err.message);
    res.status(500).json({ error: 'Внутрішня помилка шлюзу' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
