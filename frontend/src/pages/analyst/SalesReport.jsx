import { useEffect, useState, useContext } from 'react';
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

// ── Горизонтальний бар-чарт ───────────────────────────────
function SalesChart({ rows, groupBy }) {
    if (!rows || rows.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 24px' }}>
                За обраний період продажів не знайдено
            </div>
        );
    }
    const top    = rows.slice(0, 15);
    const maxQty = Math.max(...top.map(r => r.totalQuantity), 1);

    const COLORS = [
        '#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444',
        '#06b6d4','#84cc16','#f97316','#ec4899','#6366f1',
        '#14b8a6','#eab308','#a855f7','#22c55e','#fb923c'
    ];

    const colLabel = groupBy === 'product' ? 'Товар'
        : groupBy === 'category' ? 'Категорія' : 'Постачальник';

    return (
        <div style={{ padding: '16px 20px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {top.map((r, i) => {
                    const pct = Math.max(2, (r.totalQuantity / maxQty) * 100);
                    return (
                        <div key={r._id || i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 60px', gap: 12, alignItems: 'center' }}>
                            {/* Назва */}
                            <div style={{
                                fontSize: 13, color: 'var(--gray-800)',
                                fontWeight: i < 3 ? 600 : 400,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                            }} title={r.name || colLabel}>
                                {i < 3 && (
                                    <span style={{ marginRight: 6, fontSize: 11 }}>
                                        {['🥇','🥈','🥉'][i]}
                                    </span>
                                )}
                                {r.name || '—'}
                            </div>
                            {/* Бар */}
                            <div style={{ background: 'var(--gray-100)', borderRadius: 6, height: 20, overflow: 'hidden', position: 'relative' }}>
                                <div style={{
                                    width: `${pct}%`,
                                    height: '100%',
                                    background: COLORS[i % COLORS.length],
                                    borderRadius: 6,
                                    transition: 'width .3s ease',
                                    opacity: i === 0 ? 1 : 0.72 + (0.28 * (top.length - i) / top.length)
                                }} />
                            </div>
                            {/* Значення */}
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

// ── Головний компонент ────────────────────────────────────
export default function SalesReport() {
    const { user } = useContext(AuthContext);

    const today    = new Date();
    const monthAgo = new Date(today.getTime() - 30 * 86400000);

    const [filter, setFilter] = useState({
        from:    formatISO(monthAgo),
        to:      formatISO(today),
        groupBy: 'product'
    });
    const [report, setReport]   = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [exporting, setExporting] = useState(false);

    const load = async (f = filter) => {
        setLoading(true); setError('');
        try {
            const data = await getSalesReport(user.token, {
                from: f.from, to: f.to, groupBy: f.groupBy
            });
            setReport(data);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const text = await exportReportCSV(user.token, 'sales', {
                from: filter.from, to: filter.to, groupBy: filter.groupBy
            });
            downloadCSV(text, `sales_${filter.from}_${filter.to}.csv`);
        } catch (e) { setError(e.message); }
        finally { setExporting(false); }
    };

    // ── Підсумки ──────────────────────────────────────────
    const rows       = report?.data || [];
    const totalQty   = rows.reduce((s, r) => s + (r.totalQuantity || 0), 0);
    const totalOps   = rows.reduce((s, r) => s + (r.events       || 0), 0);
    const topItem    = rows[0] || null;
    const uniqueItems = rows.length;

    const groupLabel = { product: 'товарами', category: 'категоріями', supplier: 'постачальниками' }[filter.groupBy] || '';
    const colLabel   = { product: 'Товар',    category: 'Категорія',   supplier: 'Постачальник'    }[filter.groupBy] || '';

    return (
        <div className="page page--wide">
            {/* Заголовок */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">Звіт про продажі</h1>
                    <p className="page-subtitle">
                        {fmtDate(filter.from)} — {fmtDate(filter.to)} · за {groupLabel}
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

            {/* Фільтр */}
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
                <span className="filter-bar-label">Групувати:</span>
                <select className="filter-search" style={{ width: 186 }}
                        value={filter.groupBy}
                        onChange={e => setFilter(f => ({ ...f, groupBy: e.target.value }))}>
                    <option value="product">За товарами</option>
                    <option value="category">За категоріями</option>
                    <option value="supplier">За постачальниками</option>
                </select>
                <button className="btn btn--primary btn--sm" onClick={() => load()}>
                    Оновити
                </button>
            </div>

            {loading ? (
                <div className="page-loading">Завантаження звіту...</div>
            ) : (
                <>
                    {/* KPI картки */}
                    <div className="stats-grid stats-grid--4" style={{ marginBottom: 20 }}>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value">{totalQty.toLocaleString('uk-UA')}</div>
                            <div className="stat-card-label">Продано одиниць</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--green" />
                            <div className="stat-card-value">{totalOps}</div>
                            <div className="stat-card-label">Операцій продажу</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--warning" />
                            <div className="stat-card-value">{uniqueItems}</div>
                            <div className="stat-card-label">
                                {filter.groupBy === 'product'  ? 'Унікальних товарів'
                                : filter.groupBy === 'category' ? 'Категорій'
                                : 'Постачальників'}
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-bar stat-card-bar--blue" />
                            <div className="stat-card-value" style={{ fontSize: 18, lineHeight: 1.3 }}>
                                {topItem ? topItem.name : '—'}
                            </div>
                            <div className="stat-card-label">
                                Лідер продажів {topItem ? `· ${topItem.totalQuantity} од.` : ''}
                            </div>
                        </div>
                    </div>

                    {rows.length === 0 ? (
                        <div className="section-card">
                            <div className="empty-state" style={{ padding: '48px 24px' }}>
                                За обраний період і групування продажів не знайдено.<br />
                                <span style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 6, display: 'block' }}>
                                    Спробуйте розширити діапазон дат або змінити групування.
                                </span>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Бар-чарт */}
                            <div className="section-card" style={{ marginBottom: 16 }}>
                                <div className="section-card-header">
                                    <h2 className="section-card-title">
                                        Обсяг продажів — за {groupLabel}
                                    </h2>
                                    <span className="section-card-count">
                                        {rows.length > 15 ? `топ 15 з ${rows.length}` : `${rows.length} позицій`}
                                    </span>
                                </div>
                                <SalesChart rows={rows} groupBy={filter.groupBy} />
                            </div>

                            {/* Таблиця */}
                            <div className="section-card">
                                <div className="section-card-header">
                                    <h2 className="section-card-title">Деталізація</h2>
                                    <span className="section-card-count">{rows.length}</span>
                                </div>
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 40 }}>#</th>
                                            <th>{colLabel}</th>
                                            <th style={{ width: 120 }}>Продано (од.)</th>
                                            <th style={{ width: 100 }}>Операцій</th>
                                            <th style={{ width: 100 }}>Частка</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r, i) => {
                                            const share = totalQty > 0
                                                ? ((r.totalQuantity / totalQty) * 100).toFixed(1)
                                                : '0.0';
                                            return (
                                                <tr key={r._id || i}>
                                                    <td style={{ color: 'var(--gray-400)', fontWeight: 500 }}>
                                                        {i + 1}
                                                    </td>
                                                    <td className="td-name">{r.name || '—'}</td>
                                                    <td>
                                                        <strong>{r.totalQuantity.toLocaleString('uk-UA')}</strong>
                                                    </td>
                                                    <td style={{ color: 'var(--gray-500)' }}>{r.events}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <div style={{
                                                                flex: 1, height: 6,
                                                                background: 'var(--gray-100)',
                                                                borderRadius: 4, overflow: 'hidden'
                                                            }}>
                                                                <div style={{
                                                                    width: `${share}%`,
                                                                    height: '100%',
                                                                    background: 'var(--blue)',
                                                                    borderRadius: 4
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
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>
                                                {totalQty.toLocaleString('uk-UA')}
                                            </td>
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>
                                                {totalOps}
                                            </td>
                                            <td style={{ padding: '10px 20px', fontSize: 13 }}>
                                                100%
                                            </td>
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
