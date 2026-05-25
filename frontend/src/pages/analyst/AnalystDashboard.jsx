import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import {
    getStats, getDynamicsReport, getSalesReport,
    getWriteoffReport, getOperations
} from '../../api/api';

// АНАЛІТИК → «Огляд» — дашборд з ключовими показниками.
//   • Картки KPI: виручка, кількість продажів, списань, топ-товар
//   • Лінійний графік динаміки (продажі / списання / надходження)
//   • Донат: причини списань
function formatISO(d) { return d.toISOString().slice(0, 10); }
function money(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Лінійний графік із осями, легендою, точками ──────────────────────────
function DynamicsChart({ series }) {
    if (!series || series.length === 0) {
        return <div className="empty-state">Даних поки немає</div>;
    }
    const W = 760, H = 280, PADL = 44, PADR = 14, PADT = 18, PADB = 36;
    const lines = [
        { key: 'sold',     label: 'Продано',     color: '#10b981' },
        { key: 'writeoff', label: 'Списано',     color: '#6b7280' },
        { key: 'received', label: 'Надходжень',  color: '#3b82f6' },
        { key: 'expired',  label: 'Прострочено', color: '#ef4444' }
    ];
    const max = Math.max(
        ...series.flatMap(s => lines.map(l => s[l.key] || 0)), 1
    );
    const niceMax = Math.ceil(max / 5) * 5 || 5;
    const x = i => PADL + (i * (W - PADL - PADR)) / Math.max(series.length - 1, 1);
    const y = v => H - PADB - ((v / niceMax) * (H - PADT - PADB));

    const ticks = 5;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (niceMax / ticks) * i);

    const path = (key) => series.map((s, i) =>
        `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(s[key] || 0)}`).join(' ');

    return (
        <div className="chart-wrap">
            <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
                {/* сітка по Y */}
                {yTicks.map((v, i) => (
                    <g key={i}>
                        <line x1={PADL} y1={y(v)} x2={W - PADR} y2={y(v)}
                              stroke="#e5e7eb" strokeDasharray="3 3" />
                        <text x={PADL - 8} y={y(v) + 4} textAnchor="end"
                              fontSize="11" fill="#6b7280">{Math.round(v)}</text>
                    </g>
                ))}
                {/* осі */}
                <line x1={PADL} y1={PADT} x2={PADL} y2={H - PADB} stroke="#9ca3af" />
                <line x1={PADL} y1={H - PADB} x2={W - PADR} y2={H - PADB} stroke="#9ca3af" />
                {/* лінії */}
                {lines.map(l => (
                    <path key={l.key} d={path(l.key)}
                          fill="none" stroke={l.color} strokeWidth="2.5"
                          strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {/* точки */}
                {lines.map(l => series.map((s, i) => (
                    <circle key={l.key + i} cx={x(i)} cy={y(s[l.key] || 0)}
                            r="3" fill={l.color} />
                )))}
                {/* підписи дат на осі X */}
                {series.map((s, i) => (
                    series.length <= 14 || i % Math.ceil(series.length / 10) === 0
                        ? <text key={i} x={x(i)} y={H - 12}
                                fontSize="10.5" fill="#6b7280" textAnchor="middle">
                              {s.date.slice(5)}
                          </text>
                        : null
                ))}
            </svg>
            <div className="chart-legend">
                {lines.map(l => (
                    <span key={l.key} className="chart-legend-item">
                        <span className="chart-legend-dot" style={{ background: l.color }} />
                        {l.label}
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─── Donut chart (причини списань) ────────────────────────────────────────
function DonutChart({ data, colors }) {
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return <div className="empty-state">Списань ще не було</div>;
    const r = 70, cx = 90, cy = 90, stroke = 22;
    let acc = 0;
    const segs = data.map((d, i) => {
        const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
        acc += d.value;
        const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const large = (end - start) > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end);
        return {
            ...d,
            color: colors[i % colors.length],
            path: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
            pct: Math.round((d.value / total) * 100)
        };
    });
    return (
        <div className="donut-wrap">
            <svg viewBox="0 0 180 180" width="180" height="180">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
                {segs.map((s, i) => (
                    <path key={i} d={s.path} fill="none" stroke={s.color}
                          strokeWidth={stroke} strokeLinecap="butt" />
                ))}
                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="600" fill="#0f172a">
                    {total}
                </text>
                <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="#6b7280">
                    усього
                </text>
            </svg>
            <div className="donut-legend">
                {segs.map((s, i) => (
                    <div key={i} className="donut-legend-row">
                        <span className="chart-legend-dot" style={{ background: s.color }} />
                        <span className="donut-legend-label">{s.label}</span>
                        <span className="donut-legend-value">{s.value} <span className="td-muted">({s.pct}%)</span></span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function AnalystDashboard() {
    const { user } = useContext(AuthContext);
    const today    = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 86400000);
    const [filter, setFilter] = useState({
        from: formatISO(monthAgo),
        to:   formatISO(today)
    });

    const [stats, setStats]         = useState([]);
    const [dynamics, setDynamics]   = useState([]);
    const [salesData, setSalesData] = useState([]);
    const [writeoffData, setWO]     = useState([]);
    const [operations, setOps]      = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');

    const fetchAll = async () => {
        setLoading(true); setError('');
        try {
            const [s, dyn, salesR, woR, ops] = await Promise.all([
                getStats(user.token).catch(() => []),
                getDynamicsReport(user.token, { from: filter.from, to: filter.to }).catch(() => null),
                getSalesReport(user.token, { from: filter.from, to: filter.to, groupBy: 'product' }).catch(() => null),
                getWriteoffReport(user.token, { from: filter.from, to: filter.to }).catch(() => null),
                getOperations(user.token, { from: filter.from, to: filter.to }).catch(() => [])
            ]);
            setStats(s); setDynamics(dyn?.series || []);
            setSalesData(salesR?.data || []); setWO(woR?.data || []);
            setOps(Array.isArray(ops) ? ops : []);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) fetchAll(); /* eslint-disable-next-line */ }, [user]);

    // ── KPI ───────────────────────────────────────────────────────────────
    const kpi = useMemo(() => {
        // Виручка та собівартість беремо з операцій inventory-service —
        // там є фактична ціна продажу і покупки.
        let revenue = 0, saleCount = 0, soldQty = 0;
        let writeoffQty = 0, writeoffCount = 0;
        let returnCount = 0;
        for (const o of operations) {
            if (o.type === 'sale' && !o.returned) {
                revenue   += Number(o.price || 0) * Number(o.quantity || 0);
                saleCount += 1;
                soldQty   += Number(o.quantity || 0);
            } else if (o.type === 'sale' && o.returned) {
                returnCount += 1;
            } else if (o.type === 'writeoff') {
                writeoffCount += 1;
                writeoffQty   += Number(o.quantity || 0);
            }
        }
        return { revenue, saleCount, soldQty, writeoffCount, writeoffQty, returnCount };
    }, [operations]);

    const topProduct = useMemo(() => {
        return salesData[0] || null;
    }, [salesData]);

    const writeoffDonut = useMemo(() => writeoffData.map(r => ({
        label: r.label, value: r.totalQuantity
    })), [writeoffData]);

    if (loading) return <div className="page-loading">Завантаження аналітики...</div>;

    return (
        <div className="page page--wide">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Огляд</h1>
                    <p className="page-subtitle">
                        Ключові показники за період • {filter.from} — {filter.to}
                    </p>
                </div>
            </div>

            {error && <div className="alert alert--danger">{error}</div>}

            <div className="filter-bar filter-bar--analyst">
                <span className="filter-bar-label">Період:</span>
                <input className="filter-search" type="date" value={filter.from}
                       title="Початок"
                       onChange={e => setFilter({ ...filter, from: e.target.value })} />
                <span style={{ color: 'var(--gray-400)', fontSize: 13 }}>—</span>
                <input className="filter-search" type="date" value={filter.to}
                       title="Кінець"
                       onChange={e => setFilter({ ...filter, to: e.target.value })} />
                <button className="btn btn--primary btn--sm" onClick={fetchAll}>Оновити</button>
            </div>

            {/* KPI картки — фінансові показники */}
            <div className="kpi-grid">
                <div className="kpi-card kpi-card--accent">
                    <div className="kpi-card-label">Виручка</div>
                    <div className="kpi-card-value">{money(kpi.revenue)} <span className="kpi-card-unit">грн</span></div>
                    <div className="kpi-card-sub">{kpi.saleCount} операцій продажу</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-card-label">Продано (одиниць)</div>
                    <div className="kpi-card-value">{kpi.soldQty.toFixed(soldQtyIsInt(kpi.soldQty) ? 0 : 2)}</div>
                    <div className="kpi-card-sub">
                        {topProduct ? `топ: ${topProduct.name}` : '—'}
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-card-label">Списано</div>
                    <div className="kpi-card-value">{kpi.writeoffQty.toFixed(soldQtyIsInt(kpi.writeoffQty) ? 0 : 2)}</div>
                    <div className="kpi-card-sub">{kpi.writeoffCount} операцій</div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-card-label">Повернень</div>
                    <div className="kpi-card-value">{kpi.returnCount}</div>
                    <div className="kpi-card-sub">від касирів</div>
                </div>
            </div>

            <div className="analytics-grid">
                <div className="section-card section-card--chart">
                    <div className="section-card-header">
                        <h2 className="section-card-title">Динаміка операцій</h2>
                    </div>
                    <DynamicsChart series={dynamics} />
                </div>

                <div className="section-card section-card--chart">
                    <div className="section-card-header">
                        <h2 className="section-card-title">Причини списань</h2>
                    </div>
                    <DonutChart data={writeoffDonut}
                                colors={['#ef4444', '#f59e0b', '#3b82f6', '#a78bfa', '#10b981']} />
                </div>
            </div>

            <div className="section-card">
                <div className="section-card-header">
                    <h2 className="section-card-title">Топ-5 товарів за обсягом продажу</h2>
                </div>
                {salesData.length === 0
                    ? <div className="empty-state">Продажів у періоді ще не було</div>
                    : (
                        <table className="table">
                            <thead>
                            <tr>
                                <th>#</th>
                                <th>Товар</th>
                                <th>Продано (од.)</th>
                                <th>Операцій</th>
                            </tr>
                            </thead>
                            <tbody>
                            {salesData.slice(0, 5).map((r, i) => (
                                <tr key={r.name || i}>
                                    <td><strong>{i + 1}</strong></td>
                                    <td className="td-name">{r.name || '—'}</td>
                                    <td><strong>{r.totalQuantity}</strong></td>
                                    <td>{r.events}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
            </div>
        </div>
    );
}

// Дрібна допоміжна — щоб не виводити 17.000 коли число ціле
function soldQtyIsInt(n) {
    return Number.isInteger(n);
}
