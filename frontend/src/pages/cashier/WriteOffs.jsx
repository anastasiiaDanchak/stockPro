import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getInventory, writeoffProduct } from '../../api/api';
import { CATEGORY_NAMES, isFractionalAllowed } from '../../config/categories';

// Сторінка КАСИРА: «Списання товару» — drill-down + tap-to-add.
//
// Крок 1: плитки категорій.
// Крок 2: партії обраної категорії — окремими картками (бо причина списання
//         прив'язана до конкретної партії). Клік по картці одразу додає
//         партію в акт списання. Повторний клік — видаляє.
// Праворуч — акт списання: позиції з кількістю, причиною, приміткою.

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

const REASONS = [
    { value: 'expired',  label: 'Прострочення' },
    { value: 'damaged',  label: 'Пошкодження' },
    { value: 'shortage', label: 'Нестача' },
    { value: 'other',    label: 'Інше' }
];

function fmtQty(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}

function diffDays(expiry) {
    return Math.ceil((new Date(expiry) - Date.now()) / 86400000);
}

function statusBadge(days) {
    if (days < 0)   return <span className="badge badge--danger">⛔ Прострочено</span>;
    if (days <= 10) return <span className="badge badge--warning">⚠ Критично</span>;
    if (days <= 20) return <span className="badge badge--orange">⏰ Скоро</span>;
    if (days <= 30) return <span className="badge badge--blue">🔻 Увага</span>;
    return <span className="badge badge--green">Норма</span>;
}

function CategoryTile({ category, count, onClick }) {
    return (
        <button className="pos-cat-tile" onClick={onClick}
                disabled={count === 0}
                title={count === 0 ? 'Партій немає' : 'Відкрити категорію'}>
            <span className="pos-cat-tile-icon">{CATEGORY_ICONS[category] || '📦'}</span>
            <span className="pos-cat-tile-name">{category}</span>
            <span className="pos-cat-tile-count">{count} партій</span>
        </button>
    );
}

// Картка партії. Натискання — додає у акт або прибирає (tap-to-toggle).
function BatchCard({ batch, inAct, onToggle }) {
    const days = diffDays(batch.expiry);
    return (
        <button className={`pos-card pos-card--batch${inAct ? ' pos-card--in-cart' : ''}`}
                onClick={onToggle}
                title={inAct ? 'Прибрати з акта' : 'Додати в акт'}>
            <div className="pos-card-name">
                {batch.name}
            </div>
            <div className="pos-card-meta">
                <span className="td-muted">{batch.sku || ''}</span>
                {statusBadge(days)}
            </div>
            <div className="pos-card-bottom">
                <span className="pos-card-price">
                    {fmtQty(batch.quantity)} {batch.unit || 'шт.'}
                </span>
                <span className="pos-card-stock">
                    до {new Date(batch.expiry).toLocaleDateString('uk-UA')}
                </span>
            </div>
            <div className="pos-card-expiry">
                {days < 0
                    ? `${Math.abs(days)} дн. тому`
                    : `залишилось ${days} дн.`}
            </div>
        </button>
    );
}

export default function WriteOffs() {
    const { user } = useContext(AuthContext);
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [success, setSuccess] = useState('');

    const [selectedCategory, setSelectedCategory] = useState(null);
    const [search, setSearch]   = useState('');
    const [act, setAct]         = useState({});  // { batchId → { batch, qty, reason, note } }
    const [busy, setBusy]       = useState(false);

    const load = async () => {
        try {
            const inv = await getInventory(user.token, {});
            setBatches((inv || []).filter(p => Number(p.quantity) > 0));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    // Партії у кожній категорії — для плиток
    const categoryCounts = useMemo(() => {
        const m = new Map();
        for (const c of CATEGORY_NAMES) m.set(c, 0);
        for (const b of batches) m.set(b.category, (m.get(b.category) || 0) + 1);
        return m;
    }, [batches]);

    // Партії обраної категорії (з пошуком, сортуванням за терміном)
    const batchesInCategory = useMemo(() => {
        if (!selectedCategory) return [];
        const s = search.trim().toLowerCase();
        return batches
            .filter(b => b.category === selectedCategory)
            .filter(b => !s || `${b.name || ''} ${b.sku || ''}`.toLowerCase().includes(s))
            .sort((a, b) => diffDays(a.expiry) - diffDays(b.expiry));
    }, [batches, selectedCategory, search]);

    // Натискання картки — toggle (додати / прибрати)
    const toggleAct = (batch) => {
        const d = diffDays(batch.expiry);
        const fract = isFractionalAllowed(batch.category) || batch.unit === 'кг';
        const defaultQty = fract ? Math.min(0.1, Number(batch.quantity)) : 1;
        setAct(prev => {
            if (prev[batch._id]) {
                // прибрати
                const n = { ...prev }; delete n[batch._id]; return n;
            }
            // додати
            return {
                ...prev,
                [batch._id]: {
                    batch,
                    qty: defaultQty,
                    reason: d < 0 ? 'expired' : 'expired',
                    note: ''
                }
            };
        });
    };

    const setLineQty = (id, v) => {
        const num = Number(String(v).replace(',', '.'));
        setAct(prev => {
            const line = prev[id]; if (!line) return prev;
            const max = Number(line.batch.quantity);
            const capped = isFinite(num) ? Math.max(0, Math.min(num, max)) : 0;
            return { ...prev, [id]: { ...line, qty: capped } };
        });
    };
    const setLineReason = (id, v) =>
        setAct(prev => prev[id] ? { ...prev, [id]: { ...prev[id], reason: v } } : prev);
    const setLineNote = (id, v) =>
        setAct(prev => prev[id] ? { ...prev, [id]: { ...prev[id], note: v } } : prev);
    const removeLine = (id) =>
        setAct(prev => { const n = { ...prev }; delete n[id]; return n; });

    const clearAct = () => setAct({});

    const lines = useMemo(() => Object.values(act), [act]);
    const totalQty = useMemo(
        () => lines.reduce((s, l) => s + Number(l.qty || 0), 0),
        [lines]
    );

    const submit = async () => {
        const toSend = lines.filter(l => Number(l.qty) > 0);
        if (toSend.length === 0) { setError('Акт списання порожній'); return; }
        setBusy(true); setError(''); setSuccess('');
        const errs = [];
        for (const line of toSend) {
            try {
                const r = await writeoffProduct(user.token, {
                    batchId: line.batch._id,
                    quantity: Number(line.qty),
                    reason: line.reason,
                    note: line.note
                });
                if (r?.error) errs.push(`${line.batch.name}: ${r.error}`);
            } catch (e) {
                errs.push(`${line.batch.name}: ${e.message || 'помилка'}`);
            }
        }
        if (errs.length === 0) {
            setSuccess(`Списано ${toSend.length} позицій`);
            setAct({});
            setTimeout(() => setSuccess(''), 3000);
            await load();
        } else {
            setError('Помилка по позиціях: ' + errs.join('; '));
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
                            <h1 className="page-title">Списання — {selectedCategory}</h1>
                            <p className="page-subtitle">
                                Натисніть партію, щоб додати до акта. Повторне натискання — прибрати.
                            </p>
                        </>
                    ) : (
                        <>
                            <h1 className="page-title">Списання товару</h1>
                            <p className="page-subtitle">
                                Оберіть категорію. Далі — партії з найближчими термінами зверху.
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
                        <div className="pos-cat-tiles">
                            {CATEGORY_NAMES.map(c => (
                                <CategoryTile key={c}
                                              category={c}
                                              count={categoryCounts.get(c) || 0}
                                              onClick={() => setSelectedCategory(c)} />
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className="pos-search">
                                <input className="pos-search-input"
                                       autoFocus
                                       placeholder="🔍  Пошук у категорії..."
                                       value={search}
                                       onChange={e => setSearch(e.target.value)} />
                            </div>

                            {batchesInCategory.length === 0
                                ? <div className="empty-state">Партій немає</div>
                                : (
                                    <div className="pos-cards">
                                        {batchesInCategory.map(b => (
                                            <BatchCard key={b._id} batch={b}
                                                       inAct={!!act[b._id]}
                                                       onToggle={() => toggleAct(b)} />
                                        ))}
                                    </div>
                                )}
                        </>
                    )}
                </div>

                {/* ── Акт списання ── */}
                <aside className="pos-receipt">
                    <div className="pos-receipt-header">
                        <h3 className="pos-receipt-title">Акт списання</h3>
                        {lines.length > 0 && (
                            <button className="btn btn--sm btn--outline" onClick={clearAct}>
                                Очистити
                            </button>
                        )}
                    </div>

                    {lines.length === 0 ? (
                        <div className="pos-receipt-empty">
                            <div>📝</div>
                            <div>Натисніть на партії в каталозі</div>
                        </div>
                    ) : (
                        <>
                            <ul className="pos-receipt-list">
                                {lines.map(l => {
                                    const id = l.batch._id;
                                    const d  = diffDays(l.batch.expiry);
                                    const fract = isFractionalAllowed(l.batch.category) || l.batch.unit === 'кг';
                                    return (
                                        <li className="pos-line" key={id}>
                                            <div className="pos-line-top">
                                                <div className="pos-line-name">
                                                    {l.batch.name}
                                                    {d < 0 && (
                                                        <span className="badge badge--danger"
                                                              style={{ marginLeft: 6 }}>прострочено</span>
                                                    )}
                                                </div>
                                                <button className="pos-line-remove"
                                                        onClick={() => removeLine(id)}
                                                        title="Прибрати з акта">✕</button>
                                            </div>
                                            <div className="pos-line-controls">
                                                <input type="number"
                                                       className="pos-line-qty"
                                                       step={fract ? '0.001' : '1'}
                                                       min="0"
                                                       max={l.batch.quantity}
                                                       value={l.qty}
                                                       onChange={e => setLineQty(id, e.target.value)} />
                                                <span className="pos-line-unit">{l.batch.unit || 'шт.'}</span>
                                                <span className="td-muted" style={{ marginLeft: 6, fontSize: 12 }}>
                                                    із {fmtQty(l.batch.quantity)}
                                                </span>
                                            </div>
                                            <div className="pos-line-fields">
                                                <select className="form-input form-input--inline"
                                                        value={l.reason}
                                                        onChange={e => setLineReason(id, e.target.value)}>
                                                    {REASONS.map(r => (
                                                        <option key={r.value} value={r.value}>{r.label}</option>
                                                    ))}
                                                </select>
                                                <input className="form-input form-input--inline"
                                                       placeholder="Примітка (необовʼязково)"
                                                       value={l.note}
                                                       onChange={e => setLineNote(id, e.target.value)} />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>

                            <div className="pos-receipt-summary">
                                <div className="pos-receipt-row">
                                    <span>Позицій</span>
                                    <strong>{lines.length}</strong>
                                </div>
                                <div className="pos-receipt-row pos-receipt-row--total">
                                    <span>Усього до списання</span>
                                    <strong>{fmtQty(totalQty)}</strong>
                                </div>
                            </div>

                            <button className="btn btn--danger btn--full pos-checkout"
                                    onClick={submit}
                                    disabled={busy || totalQty <= 0}>
                                {busy ? 'Оформлення...' : 'Оформити списання'}
                            </button>
                        </>
                    )}
                </aside>
            </div>
        </div>
    );
}
