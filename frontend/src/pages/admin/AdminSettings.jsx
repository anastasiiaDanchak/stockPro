import { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import {
    getExpirationSettings, updateExpirationSettings, listUsers,
    getSupplySettings, updateSupplySettings, deleteUser
} from '../../api/api';
import Register from '../Register';

// Налаштування адміністратора:
// 1) контроль термінів придатності (інтервал, пороги)
// 2) постачання — постачальники, перелік швидкопсувних категорій, cron
// 3) реєстрація нових користувачів
// 4) список користувачів
export default function AdminSettings() {
    const { user } = useContext(AuthContext);
    const [exp, setExp]             = useState(null);
    const [supply, setSupply]       = useState(null);
    const [users, setUsers]         = useState([]);
    const [error, setError]         = useState('');
    const [success, setSuccess]     = useState('');
    const [loading, setLoading]     = useState(true);

    useEffect(() => {
        if (!user) return;
        (async () => {
            try {
                const [e, s, us] = await Promise.all([
                    getExpirationSettings(user.token).catch(() => null),
                    getSupplySettings(user.token).catch(() => null),
                    listUsers(user.token).catch(() => [])
                ]);
                setExp(e);
                setSupply(s);
                setUsers(us);
            } catch (e) { setError(e.message); }
            finally { setLoading(false); }
        })();
    }, [user]);

    const saveExp = async (e) => {
        e.preventDefault();
        setError(''); setSuccess('');
        try {
            const updated = await updateExpirationSettings(user.token, exp);
            setExp(updated);
            setSuccess('Параметри термінів збережено');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) { setError(e.message); }
    };

    // REQ-1.5: видалення користувача (адмін → касир/аналітик)
    const removeUser = async (u) => {
        if (u.id === user.id) {
            setError('Не можна видалити власний акаунт');
            return;
        }
        if (u.role === 'admin') {
            setError('Адміністраторів не можна видаляти через інтерфейс');
            return;
        }
        if (!window.confirm(`Видалити користувача "${u.fullName || u.email}"?`)) return;
        setError(''); setSuccess('');
        try {
            await deleteUser(user.token, u.id);
            setUsers(users.filter(x => x.id !== u.id));
            setSuccess('Користувача видалено');
            setTimeout(() => setSuccess(''), 2500);
        } catch (e) { setError(e.message); }
    };

    const saveSupply = async (e) => {
        e.preventDefault();
        setError(''); setSuccess('');
        try {
            const updated = await updateSupplySettings(user.token, supply);
            setSupply(updated);
            setSuccess('Параметри постачання збережено');
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) { setError(e.message); }
    };

    // helpers — постачальники
    const addSupplier = () => setSupply({ ...supply, suppliers: [...(supply.suppliers || []), ''] });
    const setSupplier = (i, v) => {
        const arr = [...(supply.suppliers || [])]; arr[i] = v;
        setSupply({ ...supply, suppliers: arr });
    };
    const removeSupplier = (i) =>
        setSupply({ ...supply, suppliers: (supply.suppliers || []).filter((_, idx) => idx !== i) });

    // helpers — швидкопсувні категорії
    const addCat = () => setSupply({
        ...supply,
        perishableCategories: [...(supply.perishableCategories || []), { name: '', unit: 'шт.' }]
    });
    const setCatName = (i, v) => {
        const arr = [...(supply.perishableCategories || [])]; arr[i] = { ...arr[i], name: v };
        setSupply({ ...supply, perishableCategories: arr });
    };
    const setCatUnit = (i, v) => {
        const arr = [...(supply.perishableCategories || [])]; arr[i] = { ...arr[i], unit: v };
        setSupply({ ...supply, perishableCategories: arr });
    };
    const removeCat = (i) => setSupply({
        ...supply,
        perishableCategories: (supply.perishableCategories || []).filter((_, idx) => idx !== i)
    });

    if (loading) return <div className="page-loading">Завантаження...</div>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Адмін-налаштування</h1>
                    <p className="page-subtitle">Параметри сервісів і користувачів</p>
                </div>
            </div>

            {error   && <div className="alert alert--danger">{error}</div>}
            {success && <div className="alert alert--success">{success}</div>}

            {/* Контроль термінів */}
            {exp && (
                <div className="section-card section-card--form">
                    <h2 className="section-card-title" style={{ marginBottom: '1rem' }}>
                        Контроль термінів придатності
                    </h2>
                    <form onSubmit={saveExp} className="inline-form">
                        <div className="form-group">
                            <label className="form-label">Інтервал сканування (хв.)</label>
                            <input className="form-input" type="number" min="1"
                                   value={exp.scanIntervalMinutes}
                                   onChange={e => setExp({ ...exp, scanIntervalMinutes: Number(e.target.value) })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Поріг "критично" (днів)</label>
                            <input className="form-input" type="number" min="1"
                                   value={exp.thresholds?.critical ?? 3}
                                   onChange={e => setExp({ ...exp, thresholds: { ...exp.thresholds, critical: Number(e.target.value) } })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Поріг "увага" (днів)</label>
                            <input className="form-input" type="number" min="1"
                                   value={exp.thresholds?.warning ?? 7}
                                   onChange={e => setExp({ ...exp, thresholds: { ...exp.thresholds, warning: Number(e.target.value) } })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Поріг "інформаційно" (днів)</label>
                            <input className="form-input" type="number" min="1"
                                   value={exp.thresholds?.info ?? 30}
                                   onChange={e => setExp({ ...exp, thresholds: { ...exp.thresholds, info: Number(e.target.value) } })} />
                        </div>
                        <div className="form-actions">
                            <button className="btn btn--primary" type="submit">Зберегти</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Постачання */}
            {supply && (
                <div className="section-card section-card--form">
                    <h2 className="section-card-title" style={{ marginBottom: '1rem' }}>
                        Постачання — автоматичні накладні
                    </h2>
                    <form onSubmit={saveSupply}>
                        <div className="inline-form" style={{ marginBottom: '1rem' }}>
                            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                <input id="cron-enabled" type="checkbox" checked={!!supply.cronEnabled}
                                       onChange={e => setSupply({ ...supply, cronEnabled: e.target.checked })} />
                                <label htmlFor="cron-enabled" style={{ fontSize: '.9rem' }}>
                                    Автоматично генерувати «вільні» накладні за cron
                                </label>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Cron-розклад</label>
                                <input className="form-input" value={supply.cronSchedule || ''}
                                       onChange={e => setSupply({ ...supply, cronSchedule: e.target.value })}
                                       placeholder="0 9 * * * (щодня о 9:00)" />
                            </div>
                            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                <input id="auto-delivery" type="checkbox" checked={!!supply.autoDeliveryEnabled}
                                       onChange={e => setSupply({ ...supply, autoDeliveryEnabled: e.target.checked })} />
                                <label htmlFor="auto-delivery" style={{ fontSize: '.9rem' }}>
                                    Авто-доставка надісланих замовлень
                                </label>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Затримка доставки (хв.)</label>
                                <input className="form-input" type="number" min="0"
                                       value={supply.deliveryDelayMinutes ?? 1}
                                       onChange={e => setSupply({ ...supply, deliveryDelayMinutes: Number(e.target.value) })} />
                            </div>
                        </div>

                        <h3 style={{ fontSize: '14px', marginTop: '1rem' }}>Постачальники</h3>
                        {(supply.suppliers || []).map((s, i) => (
                            <div key={i} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem' }}>
                                <input className="form-input" value={s}
                                       onChange={e => setSupplier(i, e.target.value)} />
                                <button type="button" className="btn btn--sm btn--gray" onClick={() => removeSupplier(i)}>✕</button>
                            </div>
                        ))}
                        <button type="button" className="btn btn--sm btn--gray" onClick={addSupplier}>
                            + Постачальник
                        </button>

                        <h3 style={{ fontSize: '14px', marginTop: '1rem' }}>Швидкопсувні категорії</h3>
                        <p className="td-muted" style={{ fontSize: '12px', marginBottom: '.5rem' }}>
                            Тільки ці категорії доступні у формі замовлень на постачання
                        </p>
                        {(supply.perishableCategories || []).map((c, i) => (
                            <div key={i} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem' }}>
                                <input className="form-input" value={c.name}
                                       onChange={e => setCatName(i, e.target.value)}
                                       placeholder="фрукти" />
                                <select className="form-input" value={c.unit}
                                        onChange={e => setCatUnit(i, e.target.value)}
                                        style={{ maxWidth: '100px' }}>
                                    <option value="шт.">шт.</option>
                                    <option value="кг">кг</option>
                                </select>
                                <button type="button" className="btn btn--sm btn--gray" onClick={() => removeCat(i)}>✕</button>
                            </div>
                        ))}
                        <button type="button" className="btn btn--sm btn--gray" onClick={addCat}>
                            + Категорія
                        </button>

                        <div className="form-actions" style={{ marginTop: '1rem' }}>
                            <button className="btn btn--primary" type="submit">Зберегти параметри постачання</button>
                        </div>
                    </form>
                </div>
            )}

            <Register />

            <div className="section-card">
                <div className="section-card-header">
                    <h2 className="section-card-title">Користувачі системи</h2>
                    <span className="section-card-count">{users.length}</span>
                </div>
                {users.length === 0
                    ? <div className="empty-state">Немає користувачів</div>
                    : (
                        <table className="table">
                            <thead>
                            <tr>
                                <th>Імʼя</th>
                                <th>Email</th>
                                <th>Роль</th>
                                <th>Створено</th>
                                <th>Дії</th>
                            </tr>
                            </thead>
                            <tbody>
                            {users.map(u => {
                                const isSelf  = u.id === user.id;
                                const isAdmin = u.role === 'admin';
                                const canDelete = !isSelf && !isAdmin;
                                return (
                                    <tr key={u.id}>
                                        <td className="td-name">{u.fullName || <span className="td-muted">—</span>}</td>
                                        <td>{u.email}</td>
                                        <td><span className={`role-badge role-badge--${u.role}`}>{u.role}</span></td>
                                        <td className="td-date">{u.createdAt ? new Date(u.createdAt).toLocaleString('uk-UA') : '—'}</td>
                                        <td>
                                            {canDelete ? (
                                                <button className="btn btn--sm btn--danger"
                                                        onClick={() => removeUser(u)}>
                                                    Видалити
                                                </button>
                                            ) : (
                                                <span className="td-muted" style={{ fontSize: 11 }}>
                                                    {isSelf ? 'це ви' : 'адмін'}
                                                </span>
                                            )}
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
