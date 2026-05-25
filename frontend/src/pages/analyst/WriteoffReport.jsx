import { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getWriteoffReport, exportReportCSV } from '../../api/api';

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

const REASON_META = {
    expired:  { color: '#ef4444', icon: '⏰' },
    damaged:  { color: '#f97316', icon: '💥' },
    shortage: { color: '#f59e0b', icon: '📉' },
    other:    { color: '#6366f1', icon: '📋' },
};

function WriteoffChart({ rows }) {
    if (!rows || rows.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 24px' }}>
                За обраний період списань не знайдено
            </div>
        );
    }
    const max = Math.max(...rows.map(r => r.totalQuantity || 0), 1);
    return (
        <div style={{ padding: '16px 20px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((r, i) => {
                    const meta = REASON_META[r.reason] || { color: '#94a3b8', icon: '📋' };
                    const pct  = Math.max(2, (r.totalQuantity / max) * 100);
                    return (
                        <div key={r.reason || i} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 60px', gap: 12, alignItems: 'center' }}>
                            <div style={{ fontSize: 13, color: 'var(--gray-800)', fontWeight: 600,
                                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <span style={{ marginRight: 6 }}>{meta.icon}</span>
                                {r.label || r.reason || '—'}
                            </div>
                            <div style={{ background: 'var(--gray-100)', borderRadius: 6, height: 20, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${pct}%`, height: '100%',
                                    background: meta.color, borderRadius: 6,
                                    transition: 'width .3s ease'
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

export default function WriteoffReport() {
    const { user } = useContext(AuthContext);

    const today    = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    const [filter, setFilter] = useState({
        from: formatISO(monthAgo),
        to:   formatISO(today)
    });
    const [report, setReport]       = useState(null);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [exporting, setExporting] = useState(false);

    const load = async (f = filter) => {
        setLoading(true); setError('');
        try {
            const data = await getWriteoffReport(user.token, { from: f.from, to: f.to });
            setReport(data);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const text = await exportReportCSV(user.token, 'writeoff', {
                from: filter.from, to: filter.to
            });
            downloadCSV(text, `writeoff_${filter.from}_${filter.to}.csv`);
        } catch (e) { setError(e.message); }
        finally { setExporting(false); }
    };

    const rows       = report?.data || [];
    const total      = rows.reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const totalOps   = rows.reduce((s, r) => s + (r.events       || 0), 0);
    const topRow     = rows[0] || null;
    const expiredRow = rows.find(r => r.reason === 'expired');

    return (
        <div className="page page--wide">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Звіт про списання</h1>
                    <p className="page-subtitle">
                        {fmtDate(filter.from)} — {fmtDate(filter.to)}
                    </p>
                </div>
                <button
                    className="btn btn--outline btn--sm"
                    onClick={handleExport}
                    disabled={exporting || loading || rows.length === 0}
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
                <button className="btn btn--primary btn--sm" onClick={() => load()}>
                    Оновити
                </button>
            </div>

            {loading ? (
                <div className="page-loading">Завантаження звіту...</div>
            ) : (
                <>
                    <div className="stats-grid stats-grid--4" style={{ marginBottom: 20 }}>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--gray" />
                            <div className="stat-card-value">{total.toLocaleString('uk-UA')}</div>
                            <div className="stat-card-label">Усього списано (од.)</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--warning" />
                            <div className="stat-card-value">{totalOps}</div>
                            <div className="stat-card-label">Операцій списання</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--danger" />
                            <div className="stat-card-value">{expiredRow ? expiredRow.totalQuantity : 0}</div>
                            <div className="stat-card-label">⏰ Прострочено (од.)</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value" style={{ fontSize: 18, lineHeight: 1.3 }}>
                                {topRow ? topRow.label : '—'}
                            </div>
                            <div className="stat-card-label">
                                Головна причина {topRow ? `· ${topRow.totalQuantity} од.` : ''}
                            </div>
                        </div>
                    </div>

                    {rows.length === 0 ? (
                        <div className="section-card">
                            <div className="empty-state" style={{ padding: '48px 24px' }}>
                                За обраний період списань не знайдено.<br />
                                <span style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>
                                    Спробуйте розширити діапазон дат.
                                </span>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="section-card" style={{ marginBottom: 16 }}>
                                <div className="section-card-header">
                                    <h2 className="section-card-title">Списання за причинами</h2>
                                    <span className="section-card-count">{rows.length} причин</span>
                                </div>
                                <WriteoffChart rows={rows} />
                            </div>

                            <div className="section-card">
                                <div className="section-card-header">
                                    <h2 className="section-card-title">Деталізація</h2>
                                    <span className="section-card-count">{rows.length}</span>
                                </div>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 40 }}>#</th>
                                            <th>Причина</th>
                                            <th style={{ width: 140 }}>Списано (од.)</th>
                                            <th style={{ width: 100 }}>Операцій</th>
                                            <th style={{ width: 100 }}>Частка</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r, i) => {
                                            const meta  = REASON_META[r.reason] || { color: '#94a3b8', icon: '📋' };
                                            const share = total > 0
                                                ? ((r.totalQuantity / total) * 100).toFixed(1)
                                                : '0.0';
                                            return (
                                                <tr key={r.reason || i}>
                                                    <td style={{ color: 'var(--gray-400)', fontWeight: 500 }}>{i + 1}</td>
                                                    <td>
                                                        <span style={{ marginRight: 6 }}>{meta.icon}</span>
                                                        <strong>{r.label || r.reason || '—'}</strong>
                                                    </td>
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
                                                                    width: `${share}%`, height: '100%',
                                                                    background: meta.color, borderRadius: 4
                                                                }} />
                                                            </div>
                                                            <span style={{ fontSize: 12, color: 'var(--gray-500)', minWidth: 36 }}>
                                                                {share}%
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
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>{total.toLocaleString('uk-UA')}</td>
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
