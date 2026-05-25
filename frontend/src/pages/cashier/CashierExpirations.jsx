import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import { getInventory } from '../../api/api';

// Сторінка КАСИРА: «Терміни зі знижкою».
// Система автоматично формує цей список:
//   • 30 днів до кінця → −10%
//   • 20 днів до кінця → −25%
//   • 10 днів до кінця → −50%
// Касир бачить рекомендовану знижку та фактичну ціну продажу.
function diffDays(expiry) {
    return Math.ceil((new Date(expiry) - Date.now()) / 86400000);
}

function recommendedDiscount(d) {
    if (d < 0)   return null;
    if (d <= 10) return 50;
    if (d <= 20) return 25;
    if (d <= 30) return 10;
    return 0;
}

// Узгоджено зі сповіщеннями — 4 стани, прив'язані до знижок:
//   Прострочено / Критично (≤10, −50%) / Скоро (≤20, −25%) / Увага (≤30, −10%)
function statusFor(d) {
    if (d < 0)   return { label: 'Прострочено', cls: 'badge--danger',  key: 'expired',  icon: '⛔' };
    if (d <= 10) return { label: 'Критично',    cls: 'badge--warning', key: 'critical', icon: '⚠' };
    if (d <= 20) return { label: 'Скоро',       cls: 'badge--orange',  key: 'warning',  icon: '⏰' };
    if (d <= 30) return { label: 'Увага',       cls: 'badge--blue',    key: 'info',     icon: '🔻' };
    return { label: 'У нормі', cls: 'badge--green', key: 'ok' };
}

const TABS = [
    { key: 'all',      label: 'Усі' },
    { key: 'critical', label: 'Критично (−50%)' },
    { key: 'warning',  label: 'Скоро (−25%)' },
    { key: 'info',     label: 'Увага (−10%)' }
];

export default function CashierExpirations() {
    const { user } = useContext(AuthContext);
    const [items, setItems]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [tab, setTab]         = useState('all');

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const inv = await getInventory(user.token);
                setItems((inv || [])
                    .filter(p => Number(p.quantity) > 0 && (!p.status || p.status === 'active'))
                    .filter(p => diffDays(p.expiry) <= 30 && diffDays(p.expiry) >= 0)
                );
            } catch (e) { setError(e.message); }
            finally { setLoading(false); }
        })();
    }, [user]);

    const filtered = useMemo(() => {
        const list = items
            .map(p => ({ ...p, _days: diffDays(p.expiry) }))
            .sort((a, b) => a._days - b._days);
        if (tab === 'all') return list;
        return list.filter(p => statusFor(p._days).key === tab);
    }, [items, tab]);

    if (loading) return <div className="page-loading">Завантаження...</div>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Товари з наближеним терміном</h1>
                    <p className="page-subtitle">
                        Система автоматично нараховує знижки: 30 днів −10%, 20 днів −25%, 10 днів −50%
                    </p>
                </div>
            </div>

            {error && <div className="alert alert--danger">{error}</div>}

            <div className="filter-bar">
                <div className="filter-tabs">
                    {TABS.map(t => (
                        <button key={t.key}
                                className={`filter-tab${tab === t.key ? ' filter-tab--active' : ''}`}
                                onClick={() => setTab(t.key)}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="section-card">
                {filtered.length === 0
                    ? <div className="empty-state">Партій з наближеним терміном немає</div>
                    : (
                        <table className="table">
                            <thead>
                            <tr>
                                <th>Назва</th>
                                <th>SKU</th>
                                <th>Категорія</th>
                                <th>Залишок</th>
                                <th>Термін</th>
                                <th>Дн.</th>
                                <th>Базова</th>
                                <th>Знижка</th>
                                <th>Ціна продажу</th>
                                <th>Стан</th>
                            </tr>
                            </thead>
                            <tbody>
                            {filtered.map(p => {
                                const st = statusFor(p._days);
                                const rec = recommendedDiscount(p._days);
                                const eff = p.discountPercent || 0;
                                const base = Number(p.defaultPrice || 0);
                                const sale = Number(p.salePrice ?? base);
                                return (
                                    <tr key={p._id}>
                                        <td className="td-name">{p.name}</td>
                                        <td>{p.sku || '—'}</td>
                                        <td>{p.category || '—'}</td>
                                        <td><strong>{p.quantity}</strong> {p.unit || 'шт.'}</td>
                                        <td className="td-date">{new Date(p.expiry).toLocaleDateString('uk-UA')}</td>
                                        <td>{p._days} дн.</td>
                                        <td>{base.toFixed(2)}</td>
                                        <td>
                                            {eff > 0
                                                ? <span className="badge badge--purple">−{eff}%</span>
                                                : rec > 0
                                                    ? <span className="badge badge--orange">рек. −{rec}%</span>
                                                    : '—'}
                                        </td>
                                        <td><strong>{sale.toFixed(2)}</strong></td>
                                        <td>
                                            <span className={`badge ${st.cls}`}>
                                                {st.icon ? `${st.icon} ` : ''}{st.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    )}
            </div>
        </div>
    );
}
