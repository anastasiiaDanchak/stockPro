import { useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';
import { NavLink, useNavigate } from 'react-router-dom';
import NotificationsBell from './NotificationsBell';

const ROLE_LABELS = { admin: 'Адміністратор', cashier: 'Касир', analyst: 'Аналітик' };

// REQ: рольова навігація StockPro (без «Головної»).
//   • Адмін   — Замовлення, Накладні, Склад, Журнал операцій, Налаштування.
//   • Касир   — Продаж, Списання, Склад (перегляд), Терміни, Мої операції.
//   • Аналітик — Звіт продажів, Звіт списань, Топ продажів.
const NAV_SECTIONS = [
    {
        title: 'Адміністрування',
        roles: ['admin'],
        items: [
            { to: '/admin/supply',    label: 'Замовлення',      icon: '⛟', roles: ['admin'] },
            { to: '/admin/invoices',  label: 'Накладні',        icon: '📄', roles: ['admin'] },
            { to: '/admin/stock',     label: 'Склад',           icon: '☷', roles: ['admin'] },
            { to: '/operations',      label: 'Журнал операцій', icon: '⏲', roles: ['admin'] },
            { to: '/admin/settings',  label: 'Налаштування',    icon: '⚙', roles: ['admin'] }
        ]
    },
    {
        title: 'Каса',
        roles: ['cashier'],
        items: [
            { to: '/cashier/sales',       label: 'Продаж товару', icon: '☰', roles: ['cashier'] },
            { to: '/cashier/writeoffs',   label: 'Списання',      icon: '✕', roles: ['cashier'] },
            { to: '/cashier/stock',       label: 'Склад',         icon: '☷', roles: ['cashier'] },
            { to: '/cashier/expirations', label: 'Терміни',       icon: '◷', roles: ['cashier'] },
            { to: '/operations',          label: 'Мої операції',  icon: '⏲', roles: ['cashier'] }
        ]
    },
    {
        title: 'Аналітика',
        roles: ['analyst'],
        items: [
            { to: '/analyst/dashboard',       label: 'Огляд',          icon: '◉', roles: ['analyst'] },
            { to: '/analyst/sales-report',    label: 'Звіт продажів',  icon: '↗', roles: ['analyst'] },
            { to: '/analyst/writeoff-report', label: 'Звіт списань',   icon: '↘', roles: ['analyst'] },
            { to: '/analyst/top-sales',       label: 'Топ продажів',   icon: '★', roles: ['analyst'] }
        ]
    }
];

export default function Navbar() {
    const { user, logout } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const initials = (() => {
        if (!user) return '?';
        const name = user.fullName || user.email || ROLE_LABELS[user.role] || '?';
        return String(name).trim().slice(0, 1).toUpperCase();
    })();

    const visibleSections = NAV_SECTIONS
        .map(section => {
            if (!user) return null;
            if (section.roles && !section.roles.includes(user.role)) return null;
            const items = section.items.filter(i => i.roles.includes(user.role));
            if (items.length === 0) return null;
            return { ...section, items };
        })
        .filter(Boolean);

    // Сповіщення про терміни — тільки для касира (адмін/аналітик не задіяні).
    const showBell = user?.role === 'cashier';

    return (
        <aside className="sidebar">
            <div className="sidebar-logo">
                <span className="sidebar-logo-icon">S</span>
                <span className="sidebar-logo-text">StockPro</span>
            </div>

            <nav className="sidebar-nav">
                {visibleSections.map((section, idx) => (
                    <div className="sidebar-section" key={idx}>
                        {section.title && (
                            <div className="sidebar-section-title">{section.title}</div>
                        )}
                        {section.items.map(item => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                className={({ isActive }) =>
                                    `sidebar-link${isActive ? ' sidebar-link--active' : ''}`
                                }
                            >
                                <span className="sidebar-link-icon">{item.icon}</span>
                                {item.label}
                            </NavLink>
                        ))}
                    </div>
                ))}
            </nav>

            {user && (
                <div className="sidebar-footer">
                    {showBell && (
                        <div className="sidebar-bell">
                            <NotificationsBell />
                        </div>
                    )}
                    {/* REQ: спочатку імʼя, потім посада, потім кнопка «Вийти». */}
                    <div className="sidebar-user">
                        <div className="sidebar-avatar">{initials}</div>
                        <div className="sidebar-user-info">
                            <span className="sidebar-user-name">
                                {user.fullName || user.email || '—'}
                            </span>
                            <span className="sidebar-user-role">{ROLE_LABELS[user.role]}</span>
                        </div>
                    </div>
                    <button className="sidebar-logout" onClick={handleLogout}>
                        Вийти
                    </button>
                </div>
            )}
        </aside>
    );
}
