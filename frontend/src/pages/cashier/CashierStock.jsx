import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getInventory, getSuppliers } from '../../api/api';
import { CATEGORY_NAMES } from '../../config/categories';

// Сторінка КАСИРА: «Склад» (тільки для перегляду).
// Так само як на адмінському Складі — таблиця асортименту із зведенням
// по знижках (скільки партій −10/−25/−50%). Касир НЕ редагує склад.
function fmtNum(n) {
    if (n === null || n === undefined || n === '') return '0';
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}

function aggregateProducts(items) {
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
                batches: 0,
                quantity: 0,
                priceMin: Infinity,
                priceMax: -Infinity,
                discountBreakdown: { 10: 0, 25: 0, 50: 0, other: 0 }
            });
        }
        const a = map.get(key);
        a.quantity += Number(p.quantity) || 0;
        a.batches  += 1;
        const price = Number(p.salePrice ?? p.defaultPrice ?? 0);
        if (price < a.priceMin) a.priceMin = price;
        if (price > a.priceMax) a.priceMax = price;
        const dp = Number(p.discountPercent) || 0;
        if (dp === 10)      a.discountBreakdown[10] += 1;
        else if (dp === 25) a.discountBreakdown[25] += 1;
        else if (dp === 50) a.discountBreakdown[50] += 1;
        else if (dp >  0)   a.discountBreakdown.other += 1;
    }
    return [...map.values()]
        .map(a => ({
            ...a,
            priceMin: a.priceMin === Infinity ? 0 : a.priceMin,
            priceMax: a.priceMax === -Infinity ? 0 : a.priceMax
        }))
        .sort((x, y) => x.name.localeCompare(y.name, 'uk'));
}

// Чіпи знижок — копія компонента з адмінського Складу
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
                <span key={i} className={`badge ${b.cls}`}
                      title={`${b.cnt} партій зі знижкою ${b.pct}%`}>
                    {b.cnt}×−{b.pct}%
                </span>
            ))}
        </span>
    );
}

export default function CashierStock() {
    const { user } = useContext(AuthContext);
    const [items, setItems]     = useState([]);
    const [allSups, setAllSups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');

    const [search, setSearch]     = useState('');
    const [category, setCategory] = useState('');
    const [supplier, setSupplier] = useState('');

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const [data, sups] = await Promise.all([
                    getInventory(user.token, {}),
                    getSuppliers(user.token).catch(() => [])
                ]);
                setItems((Array.isArray(data) ? data : []).filter(p => Number(p.quantity) > 0));
                setAllSups(sups || []);
            } catch (e) { setError(e.message); }
            finally { setLoading(false); }
        })();
    }, [user]);

    const filtered = useMemo(() => {
        const s = search.trim().toLowerCase();
        return items.filter(p => {
            if (category && p.category !== category) return false;
            if (supplier && p.supplier !== supplier) return false;
            if (!s) return true;
            return `${p.name || ''} ${p.sku || ''}`.toLowerCase().includes(s);
        });
    }, [items, search, category, supplier]);

    const products = useMemo(() => aggregateProducts(filtered), [filtered]);

    // Зведення по знижках — як у адміна, щоб касир бачив масштаб
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
                        {products.length} товарів • {filtered.length} партій
                    </p>
                </div>
            </div>

            {error && <div className="alert alert--danger">{error}</div>}

            {/* Зведення зі знижками — щоб касир бачив, скільки уцінено */}
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
                <input className="filter-search"
                       placeholder="Пошук за назвою або SKU..."
                       value={search}
                       onChange={e => setSearch(e.target.value)} />
                <select className="filter-search" value={category}
                        onChange={e => setCategory(e.target.value)}>
                    <option value="">Усі категорії</option>
                    {CATEGORY_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="filter-search" value={supplier}
                        onChange={e => setSupplier(e.target.value)}>
                    <option value="">Усі постачальники</option>
                    {allSups.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>

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
        </div>
    );
}
