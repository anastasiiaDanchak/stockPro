import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getSalesReport, exportReportCSV } from '../../api/api';

function formatISO(d) { return d.toISOString().slice(0, 10); }
function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function downloadCSV(text, filename) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#b45309'];

function PodiumChart({ rows }) {
    if (!rows || rows.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 24px' }}>
                Продажів у цьому періоді немає
            </div>
        );
    }
    const max = Math.max(...rows.map(r => r.totalQuantity || 0), 1);
    return (
        <div style={{ padding: '16px 20px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((r, i) => {
                    const color = i < 3 ? RANK_COLORS[i] : '#3b82f6';
                    const pct   = Math.max(2, (r.totalQuantity / max) * 100);
                    return (
                        <div key={r.name || i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 60px', gap: 12, alignItems: 'center' }}>
                            <div style={{ fontSize: 13, color: 'var(--gray-800)',
                                          fontWeight: i < 3 ? 700 : 400,
                                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <strong style={{ color, marginRight: 6, fontSize: 12 }}>#{i + 1}</strong>
                                {i < 3 && <span style={{ marginRight: 4 }}>{['🥇','🥈','🥉'][i]}</span>}
                                {r.name || '—'}
                            </div>
                            <div style={{ background: 'var(--gray-100)', borderRadius: 6, height: 20, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${pct}%`, height: '100%',
                                    background: color, borderRadius: 6,
                                    transition: 'width .3s ease',
                                    opacity: i < 3 ? 1 : 0.7 + 0.3 * ((rows.length - i) / rows.length)
                                }} />
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-900)', textAlign: 'right' }}>
                                {r.totalQuantity}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function TopSales() {
    const { user } = useContext(AuthContext);

    const today    = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    const [filter, setFilter] = useState({
        from:  formatISO(monthAgo),
        to:    formatISO(today),
        limit: 10
    });
    const [rows, setRows]           = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [exporting, setExporting] = useState(false);

    const load = async (f = filter) => {
        setLoading(true); setError('');
        try {
            const data = await getSalesReport(user.token, {
                from: f.from, to: f.to, groupBy: 'product'
            });
            setRows(Array.isArray(data?.data) ? data.data : []);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    const top = useMemo(() => {
        return [...rows]
            .sort((a, b) => (b.totalQuantity || 0) - (a.totalQuantity || 0))
            .slice(0, filter.limit);
    }, [rows, filter.limit]);

    const totalSold = top.reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const totalOps  = top.reduce((s, r) => s + (r.events || 0), 0);
    const leader    = top[0] || null;

    const handleExport = async () => {
        setExporting(true);
        try {
            const text = await exportReportCSV(user.token, 'sales', {
                from: filter.from, to: filter.to, groupBy: 'product'
            });
            downloadCSV(text, `top_sales_${filter.from}_${filter.to}.csv`);
        } catch (e) { setError(e.message); }
        finally { setExporting(false); }
    };

    return (
        <div className="page page--wide">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Топ продажів</h1>
                    <p className="page-subtitle">
                        {fmtDate(filter.from)} — {fmtDate(filter.to)} · найпопулярніші товари
                    </p>
                </div>
                <button
                    className="btn btn--outline btn--sm"
                    onClick={handleExport}
                    disabled={exporting || loading || top.length === 0}
                >
                    {exporting ? 'Експорт...' : '↓ Завантажити CSV'}
                </button>
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
                <span className="filter-bar-sep" />
                <span className="filter-bar-label">Показати:</span>
                <select className="filter-search" style={{ width: 100 }} value={filter.limit}
                        onChange={e => setFilter(f => ({ ...f, limit: Number(e.target.value) }))}>
                    <option value={10}>Топ-10</option>
                    <option value={20}>Топ-20</option>
                    <option value={50}>Топ-50</option>
                </select>
                <button className="btn btn--primary btn--sm" onClick={() => load()}>
                    Оновити
                </button>
            </div>

            {loading ? (
                <div className="page-loading">Завантаження...</div>
            ) : (
                <>
                    <div className="stats-grid stats-grid--4" style={{ marginBottom: 20 }}>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value">{totalSold.toLocaleString('uk-UA')}</div>
                            <div className="stat-card-label">Продано одиниць</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--green" />
                            <div className="stat-card-value">{totalOps}</div>
                            <div className="stat-card-label">Операцій продажу</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--warning" />
                            <div className="stat-card-value">{top.length}</div>
                            <div className="stat-card-label">Позицій у рейтингу</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value" style={{ fontSize: 18, lineHeight: 1.3 }}>
                                {leader ? leader.name : '—'}
                            </div>
                            <div className="stat-card-label">
                                🥇 Лідер {leader ? `· ${leader.totalQuantity} од.` : ''}
                            </div>
                        </div>
                    </div>

                    {top.length === 0 ? (
                        <div className="section-card">
                            <div className="empty-state" style={{ padding: '48px 24px' }}>
                                Продажів у цьому періоді ще немає.<br />
                                <span style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>
                                    Спробуйте розширити діапазон дат.
                                </span>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="section-card" style={{ marginBottom: 16 }}>
                                <div className="section-card-header">
                                    <h2 className="section-card-title">Рейтинг товарів</h2>
                                    <span className="section-card-count">{top.length} позицій</span>
                                </div>
                                <PodiumChart rows={top} />
                            </div>

                            <div className="section-card">
                                <div className="section-card-header">
                                    <h2 className="section-card-title">Деталізація</h2>
                                    <span className="section-card-count">{top.length}</span>
                                </div>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 50 }}>#</th>
                                            <th>Товар</th>
                                            <th style={{ width: 130 }}>Продано (од.)</th>
                                            <th style={{ width: 100 }}>Операцій</th>
                                            <th style={{ width: 100 }}>Частка</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {top.map((r, i) => {
                                            const pct   = totalSold > 0
                                                ? ((r.totalQuantity / totalSold) * 100).toFixed(1)
                                                : '0.0';
                                            const medal = i < 3 ? ['🥇','🥈','🥉'][i] : null;
                                            return (
                                                <tr key={r.name || i}>
                                                    <td style={{ fontWeight: 600, color: i < 3 ? RANK_COLORS[i] : 'var(--gray-400)' }}>
                                                        {medal && <span style={{ marginRight: 4 }}>{medal}</span>}{i + 1}
                                                    </td>
                                                    <td className="td-name">{r.name || '—'}</td>
                                                    <td><strong>{r.totalQuantity.toLocaleString('uk-UA')}</strong></td>
                                                    <td style={{ color: 'var(--gray-500)' }}>{r.events}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div style={{
                                                                flex: 1, height: 6,
                                                                background: 'var(--gray-100)',
                                                                borderRadius: 4, overflow: 'hidden'
                                                            }}>
                                                                <div style={{
                                                                    width: `${pct}%`, height: '100%',
                                                                    background: 'var(--blue)', borderRadius: 4
                                                                }} />
                                                            </div>
                                                            <span style={{ fontSize: 12, color: 'var(--gray-500)', minWidth: 36 }}>
                                                                {pct}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: 'var(--gray-50)', fontWeight: 600 }}>
                                            <td colSpan={2} style={{ padding: '10px 20px', fontSize: 13, color: 'var(--gray-700)' }}>
                                                Разом
                                            </td>
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>{totalSold.toLocaleString('uk-UA')}</td>
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>{totalOps}</td>
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>100%</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
