import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getInventory, sellProduct } from '../../api/api';
import { CATEGORY_NAMES, isFractionalAllowed } from '../../config/categories';

// Сторінка КАСИРА: «Продаж товару» — drill-down інтерфейс.
//
// Крок 1: великі плитки категорій (Усі / овочі та фрукти / ...).
// Крок 2: натиснули категорію — бачимо тільки її товари у вигляді карток.
//         Натискання картки додає товар у чек, повторне — збільшує кількість.
// Праворуч постійно — «чек» з підсумком і кнопкою «Оформити продаж» (FEFO).

// Іконки категорій — підвищують впізнаваність.
const CATEGORY_ICONS = {
    'овочі та фрукти':     '🥬',
    'молочні продукти':    '🥛',
    'мʼясо та ковбаси':    '🥩',
    'випічка та хліб':     '🥖',
    'Напої':               '🥤',
    'Крупи та бакалія':    '🌾',
    'Солодощі та снеки':   '🍪',
    'Заморожені продукти': '🧊'
};

function fmtQty(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}

function diffDays(expiry) {
    return Math.ceil((new Date(expiry) - Date.now()) / 86400000);
}

// Згортаємо партії в один продукт. FEFO-партія — найближча за терміном.
function aggregateProducts(items) {
    const map = new Map();
    for (const p of items) {
        const key = `${(p.name || '').toLowerCase()}|${(p.sku || '').toLowerCase()}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                name: p.name,
                sku: p.sku,
                category: p.category || '—',
                unit: p.unit || 'шт.',
                quantity: 0,
                fefoBatch: null,
                discounted: false
            });
        }
        const a = map.get(key);
        a.quantity += Number(p.quantity) || 0;
        const d = diffDays(p.expiry);
        if (d >= 0) {
            if (!a.fefoBatch || diffDays(a.fefoBatch.expiry) > d) a.fefoBatch = p;
        } else if (!a.fefoBatch) {
            a.fefoBatch = p;
        }
        if ((p.discountPercent || 0) > 0) a.discounted = true;
    }
    return [...map.values()]
        .filter(a => a.quantity > 0)
        .sort((x, y) => x.name.localeCompare(y.name, 'uk'));
}

function priceOf(b) {
    if (!b) return 0;
    return Number(b.salePrice ?? b.defaultPrice ?? 0);
}

// Велика плитка категорії — крок 1 drill-down.
function CategoryTile({ category, count, onClick }) {
    return (
        <button className="pos-cat-tile" onClick={onClick}
                disabled={count === 0}
                title={count === 0 ? 'Товарів немає' : 'Відкрити категорію'}>
            <span className="pos-cat-tile-icon">{CATEGORY_ICONS[category] || '📦'}</span>
            <span className="pos-cat-tile-name">{category}</span>
            <span className="pos-cat-tile-count">{count} товарів</span>
        </button>
    );
}

// Картка товару — крок 2. Клік додає до чеку.
function ProductCard({ product: p, inCart, onAdd }) {
    const price = priceOf(p.fefoBatch);
    const dp    = Number(p.fefoBatch?.discountPercent) || 0;
    const fDays = p.fefoBatch ? diffDays(p.fefoBatch.expiry) : null;
    return (
        <button className={`pos-card${inCart ? ' pos-card--in-cart' : ''}`}
                onClick={onAdd}
                title="Додати у чек">
            <div className="pos-card-name">{p.name}</div>
            <div className="pos-card-meta">
                <span className="td-muted">{p.sku || ''}</span>
                {dp > 0 && <span className="badge badge--purple">−{dp}%</span>}
            </div>
            <div className="pos-card-bottom">
                <span className="pos-card-price">
                    {price.toFixed(2)} грн
                    <span className="pos-card-unit"> / {p.unit}</span>
                </span>
                <span className="pos-card-stock">{fmtQty(p.quantity)} {p.unit}</span>
            </div>
            {fDays !== null && fDays <= 30 && fDays >= 0 && (
                <div className="pos-card-expiry">термін: {fDays} дн.</div>
            )}
        </button>
    );
}

export default function Sales() {
    const { user } = useContext(AuthContext);
    const [items, setItems]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [success, setSuccess] = useState('');

    const [selectedCategory, setSelectedCategory] = useState(null);  // null = екран категорій
    const [search, setSearch]       = useState('');
    const [receipt, setReceipt]     = useState([]);
    const [busy, setBusy]           = useState(false);

    const load = async () => {
        try {
            const inv = await getInventory(user.token, {});
            setItems((inv || [])
                .filter(p => Number(p.quantity) > 0 && (!p.status || p.status === 'active')));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    const products = useMemo(() => aggregateProducts(items), [items]);

    // Скільки товарів у кожній категорії — для плиток
    const categoryCounts = useMemo(() => {
        const m = new Map();
        for (const c of CATEGORY_NAMES) m.set(c, 0);
        for (const p of products) m.set(p.category, (m.get(p.category) || 0) + 1);
        return m;
    }, [products]);

    // Товари обраної категорії з урахуванням пошуку
    const productsInCategory = useMemo(() => {
        if (!selectedCategory) return [];
        const s = search.trim().toLowerCase();
        return products
            .filter(p => p.category === selectedCategory)
            .filter(p => !s || `${p.name || ''} ${p.sku || ''}`.toLowerCase().includes(s));
    }, [products, selectedCategory, search]);

    const addToReceipt = (p) => {
        if (!p.fefoBatch) return;
        const fract = isFractionalAllowed(p.category) || p.unit === 'кг';
        const step = fract ? 0.1 : 1;
        const unitPrice = priceOf(p.fefoBatch);
        const discount  = Number(p.fefoBatch.discountPercent) || 0;
        setReceipt(prev => {
            const idx = prev.findIndex(x => x.key === p.key);
            if (idx >= 0) {
                const next = [...prev];
                const newQty = +(next[idx].qty + step).toFixed(3);
                next[idx] = { ...next[idx], qty: Math.min(newQty, p.quantity) };
                return next;
            }
            return [...prev, {
                key: p.key,
                name: p.name,
                unit: p.unit,
                category: p.category,
                qty: step,
                unitPrice,
                discountPercent: discount,
                available: p.quantity
            }];
        });
    };

    const setQty = (key, v) => {
        const num = Number(String(v).replace(',', '.'));
        setReceipt(prev => prev.map(line => {
            if (line.key !== key) return line;
            const capped = isFinite(num) ? Math.max(0, Math.min(num, line.available)) : 0;
            return { ...line, qty: capped };
        }));
    };

    const removeLine = (key) =>
        setReceipt(prev => prev.filter(l => l.key !== key));

    const clearReceipt = () => setReceipt([]);

    const total = useMemo(
        () => receipt.reduce((s, l) => s + l.qty * l.unitPrice, 0),
        [receipt]
    );
    const totalItems = useMemo(
        () => receipt.reduce((s, l) => s + l.qty, 0),
        [receipt]
    );

    const checkout = async () => {
        const lines = receipt.filter(l => l.qty > 0);
        if (lines.length === 0) { setError('Чек порожній'); return; }
        setBusy(true); setError(''); setSuccess('');
        const errors = [];
        for (const line of lines) {
            try {
                const r = await sellProduct(user.token, {
                    productName: line.name,
                    quantity: line.qty
                });
                if (r?.error) errors.push(`${line.name}: ${r.error}`);
            } catch (e) {
                errors.push(`${line.name}: ${e.message || 'помилка'}`);
            }
        }
        if (errors.length === 0) {
            setSuccess(`Оформлено ${lines.length} позицій на суму ${total.toFixed(2)} грн`);
            setReceipt([]);
            setTimeout(() => setSuccess(''), 3000);
            await load();
        } else {
            setError('Деякі позиції не вдалось продати: ' + errors.join('; '));
            await load();
        }
        setBusy(false);
    };

    if (loading) return <div className="page-loading">Завантаження...</div>;

    return (
        <div className="page page--pos">
            <div className="page-header">
                <div>
                    {selectedCategory ? (
                        <>
                            <div className="pos-breadcrumb">
                                <button className="pos-breadcrumb-link"
                                        onClick={() => { setSelectedCategory(null); setSearch(''); }}>
                                    ← Категорії
                                </button>
                                <span className="pos-breadcrumb-sep">/</span>
                                <span className="pos-breadcrumb-current">
                                    {CATEGORY_ICONS[selectedCategory] || '📦'} {selectedCategory}
                                </span>
                            </div>
                            <h1 className="page-title">Продаж — {selectedCategory}</h1>
                            <p className="page-subtitle">
                                Натисніть товар, щоб додати у чек
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className="page-title">Продаж товару</h1>
                            <p className="page-subtitle">
                                Оберіть категорію
                            </p>
                        </>
                    )}
                </div>
            </div>

            {success && <div className="alert alert--success">{success}</div>}
            {error   && <div className="alert alert--danger">{error}</div>}

            <div className="pos-grid">
                <div className="pos-left">
                    {selectedCategory === null ? (
                        /* ─── Крок 1: плитки категорій ─── */
                        <div className="pos-cat-tiles">
                            {CATEGORY_NAMES.map(c => (
                                <CategoryTile key={c}
                                              category={c}
                                              count={categoryCounts.get(c) || 0}
                                              onClick={() => setSelectedCategory(c)} />
                            ))}
                        </div>
                    ) : (
                        /* ─── Крок 2: товари обраної категорії ─── */
                        <>
                            <div className="pos-search">
                                <input className="pos-search-input"
                                       autoFocus
                                       placeholder="🔍  Пошук у категорії..."
                                       value={search}
                                       onChange={e => setSearch(e.target.value)} />
                            </div>

                            {productsInCategory.length === 0
                                ? <div className="empty-state">Товарів у категорії немає</div>
                                : (
                                    <div className="pos-cards">
                                        {productsInCategory.map(p => (
                                            <ProductCard key={p.key} product={p}
                                                         inCart={!!receipt.find(l => l.key === p.key)}
                                                         onAdd={() => addToReceipt(p)} />
                                        ))}
                                    </div>
                                )}
                        </>
                    )}
                </div>

                {/* ── Чек ── */}
                <aside className="pos-receipt">
                    <div className="pos-receipt-header">
                        <h3 className="pos-receipt-title">Чек</h3>
                        {receipt.length > 0 && (
                            <button className="btn btn--sm btn--outline" onClick={clearReceipt}>
                                Очистити
                            </button>
                        )}
                    </div>

                    {receipt.length === 0 ? (
                        <div className="pos-receipt-empty">
                            <div>🧾</div>
                            <div>Додайте товари з каталогу</div>
                        </div>
                    ) : (
                        <>
                            <ul className="pos-receipt-list">
                                {receipt.map(l => {
                                    const fract = isFractionalAllowed(l.category) || l.unit === 'кг';
                                    return (
                                        <li className="pos-line" key={l.key}>
                                            <div className="pos-line-top">
                                                <div className="pos-line-name">
                                                    {l.name}
                                                    {l.discountPercent > 0 && (
                                                        <span className="badge badge--purple"
                                                              style={{ marginLeft: 6 }}>
                                                            −{l.discountPercent}%
                                                        </span>
                                                    )}
                                                </div>
                                                <button className="pos-line-remove"
                                                        onClick={() => removeLine(l.key)}
                                                        title="Видалити">✕</button>
                                            </div>
                                            <div className="pos-line-controls">
                                                <input type="number"
                                                       className="pos-line-qty"
                                                       step={fract ? '0.001' : '1'}
                                                       min="0"
                                                       max={l.available}
                                                       value={l.qty}
                                                       onChange={e => setQty(l.key, e.target.value)} />
                                                <span className="pos-line-unit">{l.unit}</span>
                                                <span className="pos-line-x">×</span>
                                                <span className="pos-line-price">
                                                    {l.unitPrice.toFixed(2)} грн
                                                </span>
                                                <span className="pos-line-total">
                                                    = {(l.qty * l.unitPrice).toFixed(2)} грн
                                                </span>
                                            </div>
                                            <div className="pos-line-meta">
                                                Доступно: {fmtQty(l.available)} {l.unit}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>

                            <div className="pos-receipt-summary">
                                <div className="pos-receipt-row">
                                    <span>Позицій</span>
                                    <strong>{receipt.length}</strong>
                                </div>
                                <div className="pos-receipt-row">
                                    <span>К-сть</span>
                                    <strong>{fmtQty(totalItems)}</strong>
                                </div>
                                <div className="pos-receipt-row pos-receipt-row--total">
                                    <span>До сплати</span>
                                    <strong>{total.toFixed(2)} грн</strong>
                                </div>
                            </div>

                            <button className="btn btn--green btn--full pos-checkout"
                                    onClick={checkout}
                                    disabled={busy || total <= 0}>
                                {busy ? 'Оформлення...' : `Оформити продаж • ${total.toFixed(2)} грн`}
                            </button>
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
}
