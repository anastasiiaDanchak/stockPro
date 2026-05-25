import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getSalesReport, getOperations } from '../../api/api';

function formatISO(d) { return d.toISOString().slice(0, 10); }
function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });
}
function money(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function HorizontalBars({ rows, max, color }) {
    if (!rows || rows.length === 0) {
        return <div className="empty-state" style={{ padding: '32px 20px' }}>Даних поки немає</div>;
    }
    return (
        <div style={{ padding: '16px 20px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((r, i) => {
                    const pct = Math.max(2, (r.value / max) * 100);
                    return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', gap: 12, alignItems: 'center' }}>
                            <div style={{ fontSize: 13, color: 'var(--gray-800)', fontWeight: i === 0 ? 600 : 400,
                                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                 title={r.name}>
                                {r.name}
                            </div>
                            <div style={{ background: 'var(--gray-100)', borderRadius: 6, height: 18, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${pct}%`, height: '100%',
                                    background: color, borderRadius: 6,
                                    transition: 'width .3s ease'
                                }} />
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-900)', textAlign: 'right' }}>
                                {r.display || r.value}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function SupplierAnalysis() {
    const { user } = useContext(AuthContext);

    const today    = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    const [filter, setFilter] = useState({
        from: formatISO(monthAgo),
        to:   formatISO(today)
    });
    const [ops, setOps]           = useState([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');

    const load = async (f = filter) => {
        setLoading(true); setError('');
        try {
            const [sales, allOps] = await Promise.all([
                getSalesReport(user.token, { from: f.from, to: f.to, groupBy: 'supplier' }),
                getOperations(user.token, { from: f.from, to: f.to })
            ]);
            setOps(Array.isArray(allOps) ? allOps : []);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    const summary = useMemo(() => {
        const m = new Map();
        const ensure = (sup) => {
            if (!m.has(sup)) {
                m.set(sup, {
                    supplier: sup,
                    soldQty: 0, salesCount: 0, revenue: 0,
                    writeoffQty: 0, writeoffCount: 0,
                    expiredQty: 0,
                    received: 0
                });
            }
            return m.get(sup);
        };
        for (const o of ops) {
            const sup = o.supplier || '—';
            const row = ensure(sup);
            if (o.type === 'sale' && !o.returned) {
                row.soldQty    += Number(o.quantity) || 0;
                row.revenue    += Number(o.price || 0) * Number(o.quantity || 0);
                row.salesCount += 1;
            } else if (o.type === 'writeoff') {
                row.writeoffQty   += Number(o.quantity) || 0;
                row.writeoffCount += 1;
                if (o.reason === 'expired') row.expiredQty += Number(o.quantity) || 0;
            } else if (o.type === 'receive') {
                row.received += Number(o.quantity) || 0;
            }
        }
        return [...m.values()]
            .filter(r => r.salesCount + r.writeoffCount + r.received > 0)
            .sort((a, b) => b.revenue - a.revenue);
    }, [ops]);

    const maxRevenue  = Math.max(...summary.map(r => r.revenue), 1);
    const maxWriteoff = Math.max(...summary.map(r => r.writeoffQty), 1);

    const totalRevenue  = summary.reduce((s, r) => s + r.revenue, 0);
    const totalSold     = summary.reduce((s, r) => s + r.soldQty, 0);
    const totalWriteoff = summary.reduce((s, r) => s + r.writeoffQty, 0);
    const topSupplier   = summary[0] || null;

    return (
        <div className="page page--wide">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Аналіз постачальників</h1>
                    <p className="page-subtitle">
                        {fmtDate(filter.from)} — {fmtDate(filter.to)} · виручка, втрати та частка прострочень
                    </p>
                </div>
            </div>

            {error && <div className="alert alert--danger">{error}</div>}

            <div className="filter-bar filter-bar--analyst">
                <span className="filter-bar-label">Період:</span>
                <input className="filter-search" type="date" value={filter.from}
                       title="Початок"
                       onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} />
                <span style={{ color: 'var(--gray-400)', fontSize: 13 }}>—</span>
                <input className="filter-search" type="date" value={filter.to}
                       title="Кінець"
                       onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} />
                <button className="btn btn--primary btn--sm" onClick={() => load()}>Оновити</button>
            </div>

            {loading ? (
                <div className="page-loading">Завантаження...</div>
            ) : (
                <>
                    {/* KPI картки */}
                    <div className="stats-grid stats-grid--4" style={{ marginBottom: 20 }}>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--green" />
                            <div className="stat-card-value" style={{ fontSize: 20 }}>
                                {money(totalRevenue)}
                            </div>
                            <div className="stat-card-label">Загальна виручка (грн)</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value">{totalSold.toLocaleString('uk-UA')}</div>
                            <div className="stat-card-label">Продано одиниць</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--danger" />
                            <div className="stat-card-value">{totalWriteoff.toLocaleString('uk-UA')}</div>
                            <div className="stat-card-label">Списано одиниць</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value" style={{ fontSize: 18, lineHeight: 1.3 }}>
                                {topSupplier ? topSupplier.supplier : '—'}
                            </div>
                            <div className="stat-card-label">
                                Топ постачальник {topSupplier ? `· ${money(topSupplier.revenue)} грн` : ''}
                            </div>
                        </div>
                    </div>

                    {summary.length === 0 ? (
                        <div className="section-card">
                            <div className="empty-state" style={{ padding: '48px 24px' }}>
                                Активних постачальників у цьому періоді не знайдено.<br />
                                <span style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>
                                    Спробуйте розширити діапазон дат.
                                </span>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Два чарти поряд */}
                            <div className="analytics-grid" style={{ marginBottom: 16 }}>
                                <div className="section-card">
                                    <div className="section-card-header">
                                        <h2 className="section-card-title">Виручка по постачальниках (грн)</h2>
                                    </div>
                                    <HorizontalBars
                                        rows={summary.map(r => ({
                                            name: r.supplier,
                                            value: r.revenue,
        