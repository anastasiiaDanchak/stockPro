import { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext';
import { getNotifications, dismissNotification, checkExpiration } from '../api/api';

// REQ: 4 стани — прив'язані до автоматичних знижок:
//   • Прострочено — зняти з полиці
//   • Критично (≤10 днів, −50%)
//   • Скоро     (≤20 днів, −25%)
//   • Увага     (≤30 днів, −10%)
const SEVERITY = {
    expired:  { label: 'Прострочено', discount: null, cls: 'badge--danger',  icon: '⛔' },
    critical: { label: 'Критично',    discount: 50,   cls: 'badge--warning', icon: '⚠' },
    warning:  { label: 'Скоро',       discount: 25,   cls: 'badge--orange',  icon: '⏰' },
    info:     { label: 'Увага',       discount: 10,   cls: 'badge--blue',    icon: '🔻' }
};

// REQ-4.4: відображення сповіщень при вході користувача
export default function NotificationsBell() {
    const { user } = useContext(AuthContext);
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [open, setOpen]   = useState(false);

    // Клік по сповіщенню → перехід у відповідну вкладку.
    //   • Касир → "Терміни" (зі знижками).
    //   • Адмін → "Склад" (швидкий перегляд асортименту).
    //   • Аналітик — нічого не робимо (не його зона).
    const goToExpirations = (notif) => {
        setOpen(false);
        const batchId = notif.batchId || notif.productId || notif._id;
        const target = user?.role === 'admin'
            ? `/admin/stock`
            : user?.role === 'cashier'
                ? `/cashier/expirations${batchId ? `?batchId=${batchId}` : ''}`
                : null;
        if (target) navigate(target);
    };

    const [refreshing, setRefreshing] = useState(false);

    const load = async () => {
        try {
            const data = await getNotifications(user.token);
            // REQ: касиру показуємо лише ТЕРМІНОВЕ — те, що треба списати
            // сьогодні (≤1 день) або вже прострочено. Інші стани (Скоро,
            // Увага) залишаються видимими на вкладці «Терміни».
            setItems((data || [])
                .filter(n => !(n.dismissedBy || []).includes(user.email))
                .filter(n => n.severity === 'expired' || Number(n.diffDays) <= 1));
        } catch { /* ignore */ }
    };

    // Кнопка "Перевірити зараз" — форсуємо скан на expiration-service
    const refresh = async () => {
        setRefreshing(true);
        try {
            await checkExpiration(user.token);
            await load();
        } catch { /* ignore */ }
        finally { setRefreshing(false); }
    };

    useEffect(() => {
        if (!user) return;
        // При першому завантаженні форсуємо скан, щоб не чекати 30с після старту бекенда
        (async () => {
            try { await checkExpiration(user.token); } catch { /* ignore */ }
            load();
        })();
        const id = setInterval(load, 60000); // оновлюємо щохвилини
        return () => clearInterval(id);
        // eslint-disable-next-line
    }, [user]);

    const dismiss = async (id) => {
        try {
            await dismissNotification(user.token, id);
            setItems(items.filter(n => n._id !== id));
        } catch { /* ignore */ }
    };

    if (!user || (user.role !== 'admin' && user.role !== 'cashier')) return null;

    const count = items.length;
    const expired  = items.filter(i => i.severity === 'expired').length;
    const critical = items.filter(i => i.severity === 'critical').length;

    return (
        <div className="notifications-wrapper">
            <button
                className="notifications-bell"
                onClick={() => setOpen(!open)}
                title={`${count} активних сповіщень`}
            >
                <span className="notifications-icon">🔔</span>
                {count > 0 && (
                    <span className={`notifications-badge ${expired > 0 ? 'notifications-badge--danger' : critical > 0 ? 'notifications-badge--warning' : ''}`}>
                        {count}
                    </span>
                )}
            </button>

            {open && (
                <div className="notifications-popover">
                    <div className="notifications-header">
                        <strong>Сповіщення</strong>
                        <span className="td-muted">{count}</span>
                        <button className="btn btn--sm btn--gray"
                                onClick={refresh}
                                disabled={refreshing}
                                style={{ marginLeft: 'auto' }}
                                title="Запустити перевірку термінів зараз">
                            {refreshing ? '...' : '↻'}
                        </button>
                    </div>
                    <div className="notifications-list">
                        {count === 0
                            ? <div className="empty-state" style={{ padding: '1rem' }}>Активних сповіщень немає</div>
                            : items.slice(0, 20).map(n => {
                                const sev = SEVERITY[n.severity] || SEVERITY.info;
                                return (
                                    <div key={n._id}
                                         className="notification-row notif-item"
                                         role="button"
                                         tabIndex={0}
                                         onClick={() => goToExpirations(n)}
                                         onKeyDown={e => { if (e.key === 'Enter') goToExpirations(n); }}
                                         title="Натисніть, щоб відкрити партію на вкладці «Терміни»">
                                        <span className={`badge ${sev.cls}`}>
                                            {sev.icon} {sev.label}
                                            {sev.discount != null && (
                                                <span style={{ marginLeft: 6, opacity: .85 }}>
                                                    −{sev.discount}%
                                                </span>
                                            )}
                                        </span>
                                        <div className="notification-text">
                                            <div className="notification-title">{n.name}</div>
                                            <div className="notification-msg">{n.message}</div>
                                        </div>
                                        <button className="btn btn--sm btn--gray"
                                                onClick={(e) => { e.stopPropagation(); dismiss(n._id); }}
                                                title="Закрити">×</button>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}
        </div>
    );
}
