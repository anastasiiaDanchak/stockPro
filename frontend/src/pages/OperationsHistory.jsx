import { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';
import { getOperations, returnSaleOperation } from '../api/api';

const TYPE_LABELS = {
    receive:  { label: 'Прийом',    cls: 'badge--blue'  },
    sale:     { label: 'Продаж',    cls: 'badge--green' },
    writeoff: { label: 'Списання',  cls: 'badge--gray'  }
};

const REASON_LABELS = {
    expired:  'Прострочення',
    damaged:  'Пошкодження',
    shortage: 'Нестача',
    other:    'Інше'
};

// REQ-3.4: історія операцій з фільтрацією за датою та товаром
export default function OperationsHistory() {
    const { user } = useContext(AuthContext);
    const [items, setItems]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [filter, setFilter]   = useState({ type: '', product: '', from: '', to: '' });

    const load = async () => {
        setLoading(true);
        try {
            const data = await getOperations(user.token, {
                type:    filter.type    || undefined,
                product: filter.product || undefined,
                from:    filter.from    || undefined,
                to:      filter.to      || undefined
            });
            setItems(Array.isArray(data) ? data : []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

    const apply = (e) => { e.preventDefault(); load(); };

    // REQ-3.5: касир (та адмін) можуть повертати продажі
    const [busyReturn, setBusyReturn] = useState({});
    const [success, setSuccess] = useState('');
    const handleReturn = async (op) => {
        if (!window.confirm(`Повернути продаж "${op.productName}" (${op.quantity} ${''})? Залишок повернеться у партію.`)) return;
        setBusyReturn(b => ({ ...b, [op._id]: true }));
        try {
            await returnSaleOperation(user.token, op._id);
            setSuccess(`Повернено: ${op.productName}`);
            setTimeout(() => setSuccess(''), 2500);
            await load();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusyReturn(b => ({ ...b, [op._id]: false }));
        }
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Журнал операцій</h1>
                    <p className="page-subtitle">
                        {user?.role === 'cashier'
                            ? 'Історія ваших операцій'
                            : 'Усі операції в системі'}
                    </p>
                </div>
            </div>

            {error   && <div className="alert alert--danger">{error}</div>}
            {success && <div className="alert alert--success">{success}</div>}

            <form className="filter-bar" onSubmit={apply}>
                <input
                    className="filter-search"
                    placeholder="Назва товару"
                    value={filter.product}
                    onChange={e => setFilter({ ...filter, product: e.target.value })}
                />
                <select className="filter-search" value={filter.type}
                        onChange={e => setFilter({ ...filter, type: e.target.value })}>
                    <option value="">Усі типи</option>
                    <option value="receive">Прийоми</option>
                    <option value="sale">Продажі</option>
                    <option value="writeoff">Списання</option>
                </select>
                <input
                    className="filter-search"
                    type="date"
                    value={filter.from}
                    onChange={e => setFilter({ ...filter, from: e.target.value })}
                />
                <input
                    className="filter-search"
                    type="date"
                    value={filter.to}
                    onChange={e => setFilter({ ...filter, to: e.target.value })}
                />
                <button className="btn btn--primary" type="submit">Застосувати</button>
            </form>

            <div className="section-card">
                {loading
                    ? <div className="page-loading">Завантаження...</div>
                    : items.length === 0
                        ? <div className="empty-state">Операцій не знайдено</div>
                        : (
                            <table className="table">
                                <thead>
                                <tr>
                                    <th>Час</th>
                                    <th>Тип</th>
                                    <th>Товар</th>
                                    <th>Артикул</th>
                                    <th>Категорія</th>
                                    <th>Постачальник</th>
                                    <th>К-сть</th>
                                    <th>Користувач</th>
                                    <th>Причина / Примітка</th>
                                    {(user?.role === 'cashier' || user?.role === 'admin') && <th>Дії</th>}
                                </tr>
                                </thead>
                                <tbody>
                                {items.map(o => {
                                    const t = TYPE_LABELS[o.type] || { label: o.type, cls: 'badge--gray' };
                                    // Касир бачить кнопку повернення лише для СВОЇХ продажів,
                                    // адмін — для будь-чиїх. Повернути можна тільки те, що
                                    // ще не повернено.
                                    const isOwnSale = o.type === 'sale' && o.userEmail === user?.email;
                                    const canReturn = !o.returned
                                        && o.type === 'sale'
                                        && (isOwnSale || user?.role === 'admin');
                                    return (
                                        <tr key={o._id} className={o.returned ? 'tr--muted' : ''}>
                                            <td className="td-date">{new Date(o.timestamp).toLocaleString('uk-UA')}</td>
                                            <td>
                                                <span className={`badge ${t.cls}`}>{t.label}</span>
                                                {o.returned && (
                                                    <span className="badge badge--gray"
                                                          style={{ marginLeft: 6 }}>↩ повернено</span>
                                                )}
                                            </td>
                                            <td className="td-name">{o.productName}</td>
                                            <td>{o.sku || '—'}</td>
                                            <td>{o.category || '—'}</td>
                                            <td>{o.supplier || '—'}</td>
                                            <td>{o.quantity}</td>
                                            <td>{o.userEmail || '—'}</td>
                                            <td>
                                                {o.reason ? <span className="badge badge--orange">{REASON_LABELS[o.reason] || o.reason}</span> : null}
                                                {o.note ? <span className="td-muted"> {o.note}</span> : null}
                                                {o.returned && o.returnedAt && (
                                                    <div className="td-muted" style={{ fontSize: 11 }}>
                                                        повернуто {new Date(o.returnedAt).toLocaleString('uk-UA')}
                                                        {o.returnedBy ? ` (${o.returnedBy})` : ''}
                                                    </div>
                                                )}
                                            </td>
                                            {(user?.role === 'cashier' || user?.role === 'admin') && (
                                                <td>
                                                    {canReturn && (
                                                        <button className="btn btn--sm btn--outline"
                                                                disabled={busyReturn[o._id]}
                                                                onClick={() => handleReturn(o)}>
                                                            {busyReturn[o._id] ? '...' : '↩ Повернути'}
                                                        </button>
                                                    )}
                                                </td>
                                            )}
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
