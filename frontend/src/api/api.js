const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const authHeader = (token) => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
});

const handleJson = async (res) => {
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
    }
    return data;
};

// Глобальний callback для авто-логауту при 401 — встановлюється AuthContext
let _onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { _onUnauthorized = fn; };

// Обгортка fetch для захищених запитів: авто-логаут при закінченні токена
const authFetch = async (url, options) => {
    const res = await fetch(url, options);
    if (res.status === 401 && _onUnauthorized) {
        _onUnauthorized();
    }
    return res;
};

// ── Auth (публічні — звичайний fetch) ──────────────────────
export const login = async (email, password) => {
    const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password })
    });
    return handleJson(res);
};

// REQ-1.1: реєстрація користувача (адмін або перший користувач)
export const registerUser = async (data, token) => {
    const res = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: token ? authHeader(token) : { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return handleJson(res);
};

// ── Auth (захищені) ────────────────────────────────────────
export const listUsers = async (token) => {
    const res = await authFetch(`${API_URL}/auth/users`, { headers: authHeader(token) });
    return handleJson(res);
};

// REQ-1.5: видалення користувача (адмін)
export const deleteUser = async (token, id) => {
    const res = await authFetch(`${API_URL}/auth/users/${id}`, {
        method: 'DELETE',
        headers: authHeader(token)
    });
    return handleJson(res);
};

// ── Products / Catalog (Nomenclature) ─────────────────────
export const getCatalog = async (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authFetch(`${API_URL}/products/catalog${qs ? '?' + qs : ''}`, {
        headers: authHeader(token)
    });
    return handleJson(res);
};

export const getCategories = async (token) => {
    const res = await authFetch(`${API_URL}/products/categories`, { headers: authHeader(token) });
    return handleJson(res);
};

export const createCatalogItem = async (token, data) => {
    const res = await authFetch(`${API_URL}/products/catalog`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const updateCatalogItem = async (token, id, data) => {
    const res = await authFetch(`${API_URL}/products/catalog/${id}`, {
        method: 'PUT',
        headers: authHeader(token),
        body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const deactivateCatalogItem = async (token, id) => {
    const res = await authFetch(`${API_URL}/products/catalog/${id}`, {
        method: 'DELETE',
        headers: authHeader(token)
    });
    return handleJson(res);
};

// ── Inventory (batches) ───────────────────────────────────
export const getInventory = async (token, params = {}) => {
    const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const res = await authFetch(`${API_URL}/inventory/inventory${qs ? '?' + qs : ''}`, {
        headers: authHeader(token)
    });
    return handleJson(res);
};

export const getSuppliers = async (token) => {
    const res = await authFetch(`${API_URL}/inventory/suppliers`, { headers: authHeader(token) });
    if (!res.ok) return [];
    return res.json();
};

// REQ-2.2: реєстрація партії
export const addProduct = async (token, data) => {
    const res = await authFetch(`${API_URL}/products/add`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(data)
    });
    return handleJson(res);
};

// REQ-3.1: продаж (FEFO або з конкретної партії)
export const sellProduct = async (token, payload) => {
    const res = await authFetch(`${API_URL}/inventory/sell`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(payload)
    });
    return handleJson(res);
};

// REQ-3.2: списання з причиною
export const writeoffProduct = async (token, payload) => {
    const res = await authFetch(`${API_URL}/inventory/writeoff`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(payload)
    });
    return handleJson(res);
};

// REQ-Discount: застосувати/зняти знижку на партії (тільки адмін)
export const applyBatchDiscount = async (token, batchId, percent) => {
    const res = await authFetch(`${API_URL}/inventory/inventory/${batchId}/discount`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({ percent })
    });
    return handleJson(res);
};

// REQ-3.5: повернення продажу
export const returnSaleOperation = async (token, operationId) => {
    const res = await authFetch(`${API_URL}/inventory/operations/${operationId}/return`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({})
    });
    return handleJson(res);
};

// REQ-3.3 / REQ-3.4: журнал операцій
export const getOperations = async (token, params = {}) => {
    const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const res = await authFetch(`${API_URL}/inventory/operations${qs ? '?' + qs : ''}`, {
        headers: authHeader(token)
    });
    return handleJson(res);
};

// ── Analytics ─────────────────────────────────────────────
export const getStats = async (token) => {
    const res = await authFetch(`${API_URL}/analytics/stats`, { headers: authHeader(token) });
    return handleJson(res);
};

export const getSalesDynamics = async (token) => {
    const res = await authFetch(`${API_URL}/analytics/sales/dynamics`, { headers: authHeader(token) });
    return handleJson(res);
};

export const getRecentEvents = async (token) => {
    const res = await authFetch(`${API_URL}/analytics/events/recent`, { headers: authHeader(token) });
    return handleJson(res);
};

// REQ-5.1: звіт продажів
export const getSalesReport = async (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authFetch(`${API_URL}/analytics/reports/sales${qs ? '?' + qs : ''}`, {
        headers: authHeader(token)
    });
    return handleJson(res);
};

// REQ-5.2: звіт списань
export const getWriteoffReport = async (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authFetch(`${API_URL}/analytics/reports/writeoff${qs ? '?' + qs : ''}`, {
        headers: authHeader(token)
    });
    return handleJson(res);
};

// REQ-5.3: динаміка
export const getDynamicsReport = async (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authFetch(`${API_URL}/analytics/reports/dynamics${qs ? '?' + qs : ''}`, {
        headers: authHeader(token)
    });
    return handleJson(res);
};

// REQ-5.4: експорт у CSV
export const exportReportCSV = async (token, kind, params = {}) => {
    const qs = new URLSearchParams({ ...params, format: 'csv' }).toString();
    const res = await authFetch(`${API_URL}/analytics/reports/${kind}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Не вдалося експортувати CSV');
    return res.text();
};

// ── Expiration ────────────────────────────────────────────
export const checkExpiration = async (token) => {
    const res = await authFetch(`${API_URL}/expiration/check`, { headers: authHeader(token) });
    return handleJson(res);
};

// REQ-4.4: активні сповіщення
export const getNotifications = async (token, severity) => {
    const qs = severity ? `?severity=${severity}` : '';
    const res = await authFetch(`${API_URL}/expiration/notifications${qs}`, {
        headers: authHeader(token)
    });
    if (!res.ok) return [];
    return res.json();
};

export const dismissNotification = async (token, id) => {
    const res = await authFetch(`${API_URL}/expiration/notifications/${id}/dismiss`, {
        method: 'POST', headers: authHeader(token)
    });
    return handleJson(res);
};

// REQ-4.3: налаштування експіраційного сервісу
export const getExpirationSettings = async (token) => {
    const res = await authFetch(`${API_URL}/expiration/settings`, { headers: authHeader(token) });
    return handleJson(res);
};

export const updateExpirationSettings = async (token, data) => {
    const res = await authFetch(`${API_URL}/expiration/settings`, {
        method: 'PUT',
        headers: authHeader(token),
        body: JSON.stringify(data)
    });
    return handleJson(res);
};

// ── Supply (Invoices + Orders + Settings) ────────────────
export const getInvoices = async (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authFetch(`${API_URL}/supply/invoices${qs ? '?' + qs : ''}`, { headers: authHeader(token) });
    return handleJson(res);
};

export const getInvoice = async (token, id) => {
    const res = await authFetch(`${API_URL}/supply/invoices/${id}`, { headers: authHeader(token) });
    return handleJson(res);
};

export const updateInvoice = async (token, id, data) => {
    const res = await authFetch(`${API_URL}/supply/invoices/${id}`, {
        method: 'PUT', headers: authHeader(token), body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const confirmInvoice = async (token, id, data = {}) => {
    const res = await authFetch(`${API_URL}/supply/invoices/${id}/confirm`, {
        method: 'POST', headers: authHeader(token), body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const cancelInvoice = async (token, id) => {
    const res = await authFetch(`${API_URL}/supply/invoices/${id}/cancel`, {
        method: 'POST', headers: authHeader(token), body: JSON.stringify({})
    });
    return handleJson(res);
};

export const generateInvoice = async (token, data = {}) => {
    const res = await authFetch(`${API_URL}/supply/invoices/generate`, {
        method: 'POST', headers: authHeader(token), body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const getSupplyOrders = async (token, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authFetch(`${API_URL}/supply/orders${qs ? '?' + qs : ''}`, { headers: authHeader(token) });
    return handleJson(res);
};

export const createSupplyOrder = async (token, data) => {
    const res = await authFetch(`${API_URL}/supply/orders`, {
        method: 'POST', headers: authHeader(token), body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const updateSupplyOrder = async (token, id, data) => {
    const res = await authFetch(`${API_URL}/supply/orders/${id}`, {
        method: 'PUT', headers: authHeader(token), body: JSON.stringify(data)
    });
    return handleJson(res);
};

export const cancelSupplyOrder = async (token, id) => {
    const res = await authFetch(`${API_URL}/supply/orders/${id}`, {
        method: 'DELETE', headers: authHeader(token)
    });
    return handleJson(res);
};

export const simulateDelivery = async (token, orderId) => {
    const res = await authFetch(`${API_URL}/supply/orders/${orderId}/simulate-delivery`, {
        method: 'POST', headers: authHeader(token), body: JSON.stringify({})
    });
    return handleJson(res);
};

export const getSupplySettings = async (token) => {
    const res = await authFetch(`${API_URL}/supply/settings`, { headers: authHeader(token) });
    return handleJson(res);
};

export const updateSupplySettings = async (token, data) => {
    const res = await authFetch(`${API_URL}/supply/settings`, {
        method: 'PUT', headers: authHeader(token), body: JSON.stringify(data)
    });
    return handleJson(res);
};
