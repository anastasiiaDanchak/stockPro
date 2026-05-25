import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getInventory, getSuppliers } from '../../api/api';
import { CATEGORY_NAMES } from '../../config/categories';

// Склад — асортимент того, що зараз є на складі.
// Адмін перемикає режим перегляду:
//   • За товарами   — агрегована номенклатура (одна позиція = один продукт за SKU/назвою).
//   • За категоріями — групи з підсумками і списком товарів усередині.
//   • За партіями   — окремі партії (як «низький рівень»).
//
// Стан і дні до кінця терміну тут не показуємо — для цього є окрема вкладка «Терміни».

const VIEW_MODES = [
    { key: 'products',   label: 'За товарами' },
    { key: 'categories', label: 'За категоріями' },
    { key: 'batches',    label: 'За партіями' }
];

function fmtNum(n) {
    if (n === null || n === undefined || n === '') return '0';
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}

function aggregateProducts(items) {
    // Ключ — productId (якщо є) або name+sku.
    const map = new Map();
    for (const p of items) {
        const key = p.productId
            ? `pid:${p.productId}`
            : `n:${(p.name || '').toLowerCase()}|${(p.sku || '').toLowerCase()}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                name: p.name,
                sku: p.sku,
                category: p.category || '—',
                unit: p.unit || 'шт.',
                suppliers: new Set(),
                batches: 0,
                quantity: 0,
                priceMin: Infinity,
                priceMax: -Infinity,
                discounted: 0,
                // Зведення партій по рівню знижки: { 10: n, 25: n, 50: n, other: n }
                discountBreakdown: { 10: 0, 25: 0, 50: 0, other: 0 }
            });
        }
        const a = map.get(key);
        a.quantity += Number(p.quantity) || 0;
        a.batches  += 1;
        if (p.supplier) a.suppliers.add(p.supplier);
        const price = Number(p.salePrice ?? p.defaultPrice ?? 0);
        if (price < a.priceMin) a.priceMin = price;
        if (price > a.priceMax) a.priceMax = price;
        const dp = Number(p.discountPercent) || 0;
        if (dp > 0) {
            a.discounted += 1;
            if (dp === 10)      a.discountBreakdown[10]    += 1;
            else if (dp === 25) a.discountBreakdown[25]    += 1;
            else if (dp === 50) a.discountBreakdown[50]    += 1;
            else                a.discountBreakdown.other  += 1;
        }
    }
    return [...map.values()]
        .map(a => ({
            ...a,
            suppliers: [...a.suppliers],
            priceMin: a.priceMin === Infinity ? 0 : a.priceMin,
            priceMax: a.priceMax === -Infinity ? 0 : a.priceMax
        }))
        .sort((x, y) => x.name.localeCompare(y.name, 'uk'));
}

// Маленький компонент: показує «1×−25% 2×−10%» з кольоровими бейджами
function DiscountChips({ breakdown }) {
    if (!breakdown) return null;
    const buckets = [
        { pct: 50, cls: 'badge--danger',  cnt: breakdown[50] },
        { pct: 25, cls: 'badge--warning', cnt: breakdown[25] },
        { pct: 10, cls: 'badge--blue',    cnt: breakdown[10] }
    ].filter(b => b.cnt > 0);
    const other = breakdown.other > 0
        ? [{ pct: '?', cls: 'badge--purple', cnt: breakdown.other }]
        : [];
    const all = [...buckets, ...other];
    if (all.length === 0) return null;
    return (
        <span className="discount-chips">
            {all.map((b, i) => (
                <span key={i} className={`badge ${b.cls}`} title={`${b.cnt} партій зі знижкою ${b.pct}%`}>
                    {b.cnt}×−{b.pct}%
                </span>
            ))}
        </span>
    );
}

export default function StockByCategory() {
    const { user } = useContext(AuthContext);
    const [items, setItems]           = useState([]);
    const [allCategories, setAllCats] = useState([]);
    const [allSuppliers, setSups]     = useState([]);
    const [loading, setLoading]       = useState(true);
    const [error, setError]           = useState('');

    const [view, setView] = useState('products');
    const [search, setSearch]     = useState('');
    const [category, setCategory] = useState('');
    const [supplier, setSupplier] = useState('');
    const [expanded, setExpanded] = useState({});

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const [data, sups] = await Promise.all([
                    getInventory(user.token, {}),
                    getSuppliers(user.token).catch(() => [])
                ]);
                // Виводимо тільки те, що ще «живе» — є залишок.
                setItems((Array.isArray(data) ? data : []).filter(p => Number(p.quantity) > 0));
                // Категорії — з фіксованого config (а не з API), щоб селект
                // працював навіть коли склад порожній.
                setAllCats(CATEGORY_NAMES);
                setSups(sups || []);
            } catch (e) { setError(e.message); }
            finally { setLoading(false); }
        })();
    }, [user]);

    // ── Фільтрація на стороні клієнта (search/category/supplier) ─────────
    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return items.filter(p => {
            if (category && p.category !== category) return false;
            if (supplier && p.supplier !== supplier) return false;
            if (!s) return true;
            return `${p.name || ''} ${p.sku || ''}`.toLowerCase().includes(s);
        });
    }, [items, search, category, supplier]);

    // ── Підсумки ──────────────────────────────────────────────────────────
    const products = useMemo(() => aggregateProducts(filtered), [filtered]);
    const totalBatches = filtered.length;
    const totalProducts = products.length;
    const totalCategories = useMemo(
        () => new Set(filtered.map(p => p.category || '—')).size, [filtered]);

    // REQ: на складі бачимо зведення зі знижками (інша інфо про терміни
    // адміну не потрібна — це зона касира).
    const discountSummary = useMemo(() => {
        const out = { count: 0, byBucket: { 10: 0, 25: 0, 50: 0, other: 0 } };
        for (const p of filtered) {
            const dp = Number(p.discountPercent) || 0;
            if (dp <= 0) continue;
            out.count += 1;
            if (dp === 10)      out.byBucket[10] += 1;
            else if (dp === 25) out.byBucket[25] += 1;
            else if (dp === 50) out.byBucket[50] += 1;
            else                out.byBucket.other += 1;
        }
        return out;
    }, [filtered]);

    if (loading) return <div className="page-loading">Завантаження...</div>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Склад</h1>
                    <p className="page-subtitle">
                        {totalProducts} товарів • {totalBatches} партій • {totalCategories} категорій
                    </p>
                </div>
            </div>

            {error && <div className="alert alert--danger">{error}</div>}

            {/* Зведення зі знижками — єдина інфо про терміни на адмін-стороні. */}
            <div className="stats-grid stats-grid--4">
                <div className="stat-card">
                    <div className="stat-card-value">{discountSummary.count}</div>
                    <div className="stat-card-label">Партій зі знижкою</div>
                    <div className="stat-card-bar stat-card-bar--purple"></div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value">{discountSummary.byBucket[10]}</div>
                    <div className="stat-card-label">−10% (≤30 днів)</div>
                    <div className="stat-card-bar stat-card-bar--blue"></div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value">{discountSummary.byBucket[25]}</div>
                    <div className="stat-card-label">−25% (≤20 днів)</div>
                    <div className="stat-card-bar stat-card-bar--warning"></div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value stat-card-value--danger">
                        {discountSummary.byBucket[50]}
                    </div>
                    <div className="stat-card-label">−50% (≤10 днів)</div>
                    <div className="stat-card-bar stat-card-bar--danger"></div>
                </div>
            </div>

            <div className="filter-bar">
                <input
                    className="filter-search"
                    placeholder="Пошук за назвою або SKU..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <select className="filter-search" value={category} onChange={e => setCategory(e.target.value)}>
                    <option value="">Усі категорії</option>
                    {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="filter-search" value={supplier} onChange={e => setSupplier(e.target.value)}>
                    <option value="">Усі постачальники</option>
                    {allSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <div className="filter-tabs">
                    {VIEW_MODES.map(m => (
                        <button key={m.key}
                                className={`filter-tab${view === m.key ? ' filter-tab--active' : ''}`}
                                onClick={() => setView(m.key)}>
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── Режим: список товарів (агреговано) ──────────────────── */}
            {view === 'products' && (
                <div className="section-card">
                    {products.length === 0
                        ? <div className="empty-state">Товарів на складі немає</div>
                        : (
                            <table className="table">
                                <thead>
                                <tr>
                                    <th>Найменування</th>
                                    <th>SKU</th>
                                    <th>Категорія</th>
                                    <th>Постачальники</th>
                                    <th>Партій</th>
                                    <th>Кількість</th>
                                    <th>Ціна продажу</th>
                                </tr>
                                </thead>
                                <tbody>
                                {products.map(p => (
                                    <tr key={p.key}>
                                        <td className="td-name">{p.name}</td>
                                        <td>{p.sku || '—'}</td>
                                        <td>{p.category}</td>
                                        <td className="td-muted">
                                            {p.suppliers.length === 0 ? '—' : p.suppliers.join(', ')}
                                        </td>
                                        <td>
                                            {p.batches}
                                            {' '}
                                            <DiscountChips breakdown={p.discountBreakdown} />
                                        </td>
                                        <td><strong>{fmtNum(p.quantity)}</strong> {p.unit}</td>
                                        <td>
                                            {p.priceMin === p.priceMax
                                                ? p.priceMin.toFixed(2)
                                                : `${p.priceMin.toFixed(2)} – ${p.priceMax.toFixed(2)}`}
                                        </td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        )
                    }
                </div>
            )}

            {/* ─── Режим: за категоріями ───────────────────────────────── */}
            {view === 'categories' && (() => {
                const grouped = {};
                for (const p of products) {
                    if (!grouped[p.category]) grouped[p.category] = [];
                    grouped[p.category].push(p);
                }
                const cats = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'uk'));
                if (cats.length === 0)
                    return <div className="section-card"><div className="empty-state">Товарів немає</div></div>;
                return cats.map(cat => {
                    const arr = grouped[cat];
                    const totalQty = arr.reduce((s, p) => s + p.quantity, 0);
                    const totalBat = arr.reduce((s, p) => s + p.batches, 0);
                    const isOpen = expanded[`cat:${cat}`] !== false;
                    return (
                        <div className="section-card" key={cat}>
                            <div className="section-card-header"
                                 style={{ cursor: 'pointer' }}
                                 onClick={() => setExpanded(e => ({ ...e, [`cat:${cat}`]: !isOpen }))}>
                                <div>
                                    <h2 className="section-card-title">
                                        {isOpen ? '▾' : '▸'} {cat}
                                    </h2>
                                    <div className="td-muted">
                                        {arr.length} товарів • {totalBat} партій • {fmtNum(totalQty)} од./кг сумарно
                                    </div>
                                </div>
                            </div>
                            {isOpen && (
                                <table className="table">
                                    <thead>
                                    <tr>
                                        <th>Найменування</th>
                                        <th>SKU</th>
                                        <th>Партій</th>
                                        <th>Кількість</th>
                                        <th>Ціна</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {arr.map(p => (
                                        <tr key={p.key}>
                                            <td className="td-name">{p.name}</td>
                                            <td>{p.sku || '—'}</td>
                                            <td>
                                                {p.batches}
                                                {' '}
                                                <DiscountChips breakdown={p.discountBreakdown} />
                                            </td>
                                            <td><strong>{fmtNum(p.quantity)}</strong> {p.unit}</td>
                                            <td>
                                                {p.priceMin === p.priceMax
                                                    ? p.priceMin.toFixed(2)
                                                    : `${p.priceMin.toFixed(2)} – ${p.priceMax.toFixed(2)}`}
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    );
                });
            })()}

            {/* ─── Режим: за партіями (низький рівень) ─────────────────── */}
            {view === 'batches' && (
                <div className="section-card">
                    {filtered.length === 0
                        ? <div className="empty-state">Партій немає</div>
                        : (
                            <table className="table">
                                <thead>
                                <tr>
                                    <th>Назва</th>
                                    <th>SKU</th>
                                    <th>Категорія</th>
                                    <th>Постачальник</th>
                                    <th>Партія</th>
                                    <th>Кількість</th>
                                    <th>Дата прийому</th>
                                    <th>Ціна продажу</th>
                                </tr>
                                </thead>
                                <tbody>
                                {filtered
                                    .slice()
                                    .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded))
                                    .map(p => (
                                        <tr key={p._id}>
                                            <td className="td-name">{p.name}</td>
                                            <td>{p.sku || '—'}</td>
                                            <td>{p.category || '—'}</td>
                                            <td>{p.supplier || '—'}</td>
                                            <td className="td-muted">
                                                <code style={{ fontSize: 11 }}>{String(p._id).slice(0, 8)}</code>
                                            </td>
                                            <td><strong>{fmtNum(p.quantity)}</strong> {p.unit || 'шт.'}</td>
                                            <td className="td-date">
                                                {p.dateAdded
                                                    ? new Date(p.dateAdded).toLocaleDateString('uk-UA')
                                                    : '—'}
                                            </td>
                                            <td>
                                                {Number(p.salePrice ?? p.defaultPrice ?? 0).toFixed(2)}
                                                {p.discountPercent > 0 && (
                                                    <span className="badge badge--purple"
                                                          style={{ marginLeft: 6 }}>
                                                        −{p.discountPercent}%
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )
                    }
                </div>
            )}
        </div>
    );
}
