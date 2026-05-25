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
  