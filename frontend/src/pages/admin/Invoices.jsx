import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import {
    getInvoices, getInvoice, updateInvoice,
    confirmInvoice, cancelInvoice, generateInvoice
} from '../../api/api';

const STATUS = {
    pending:   { label: 'Очікує приймання', cls: 'badge--warning' },
    received:  { label: 'Прийнято',         cls: 'badge--green'   },
    cancelled: { label: 'Скасовано',        cls: 'badge--gray'    }
};

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('uk-UA');
}

function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('uk-UA');
}

// Сторінка адміністратора: накладні від постачальників.
// Адмін переглядає, редагує фактичну кількість і підтверджує приймання.
export default function Invoices() {
    const { user } = useContext(AuthContext);
    const [list, setList]       = useState([]);
    const [active, setActive]   = useState(null); // обрана накладна
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [success, setSuccess] = useState('');
    const [filter, setFilter]   = useState('pending');
    const [editedItems, setEditedItems] = useState({}); // { itemId: { actualQuantity } }

    const reload = async (selectId = null) => {
        try {
            const data = await getInvoices(user.token, filter !== 'all' ? { status: filter } : {});
            setList(Array.isArray(data) ? data : []);
            if (selectId) {
                const sel = await getInvoice(user.token, selectId);
                setActive(sel);
                setEditedItems({});
            }
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) reload(); /* eslint-disable-next-line */ }, [user, filter]);

    const counts = useMemo(() => ({
        pending:   list.filter(i => i.status === 'pending').length,
        received:  list.filter(i => i.status === 'received').length,
        cancelled: list.filter(i => i.status === 'cancelled').length
    }), [list]);

    const openInvoice = async (id) => {
        try {
            const inv = await getInvoice(user.token, id);
            setActive(inv);
            // прокидаємо expectedQuantity у поле "факт" як стартове значення
            const seed = {};
            inv.items.forEach(it => {
                seed[it._id] = { actualQuantity: it.actualQuantity ?? it.expectedQuantity };
            });
            setEditedItems(seed);
        } catch (e) { setError(e.message); }
    };

    const setItemQty = (itemId, value) => {
        setEditedItems(prev => ({
            ...prev,
            [itemId]: { ...(prev[itemId] || {}), actualQuantity: Number(value) }
        }));
    };

    const saveDraft = async () => {
        if (!active) return;
        try {
            const items = Object.entries(editedItems).map(([_id, v]) => ({ _id, ...v }));
            const updated = await updateInvoice(user.token, active._id, { items });
            setActive(updated);
            setSuccess('Зміни збережено');
            setTimeout(() => setSuccess(''), 2500);
        } catch (e) { setError(e.message); }
    };

    const confirmAccept = async () => {
        if (!active) return;
        if (!window.confirm(`Підтвердити приймання накладної ${active.number}? Створяться нові партії на складі.`))
            return;
        try {
            const items = Object.entries(editedItems).map(([_id, v]) => ({ _id, ...v }));
            const result = await confirmInvoice(user.token, active._id, { items });
            setActive(result.invoice || result);
            setSuccess(`Накладну ${active.number} прийнято на склад`);
            setTimeout(() => setSuccess(''), 3000);
            await reload(active._id);
        } catch (e) { setError(e.message); }
    };

    const reject = async () => {
        if (!active) return;
        if (!window.confirm(`Скасувати накладну ${active.number}?`)) return;
        try {
            // Бекенд повертає Invoice БЕЗ items — не записуємо її напряму
            // в active, інакше table.items.map() впаде. Просто перезавантажуємо.
            await cancelInvoice(user.token, active._id);
            setSuccess('Накладну скасовано');
            setTimeout(() => setSuccess(''), 2500);
            await reload(active._id);
        } catch (e) { setError(e.message); }
    };

    const generate = async () => {
        try {
            const inv = await generateInvoice(user.token, {});
            setSuccess(`Згенеровано накладну ${inv.number}`);
            setTimeout(() => setSuccess(''), 3000);
            await reload(inv._id);
        } catch (e) { setError(e.message); }
    };

    if (loading) return <div className="page-loading">Завантаження...</div>;

    return (
        <div className="page page--wide">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Накладні постачальників</h1>
                    <p className="page-subtitle">
                        Перегляньте, звірте фактичну кількість і прийміть товар на склад
                    </p>
                </div>
                <button className="btn btn--primary" onClick={generate}>
                    + Згенерувати накладну
                </button>
            </div>

            {error   && <div className="alert alert--danger">{error}</div>}
            {success && <div className="alert alert--success">{success}</div>}

            <div className="filter-bar">
                <div className="filter-tabs">
                    {[
                        { key: 'pending',   label: `Очікують (${counts.pending})` },
                        { key: 'received',  label: `Прийняті (${counts.received})` },
                        { key: 'cancelled', label: `Скасовані (${counts.cancelled})` },
                        { key: 'all',       label: 'Усі' }
                    ].map(t => (
                        <button key={t.key}
                                className={`filter-tab${filter === t.key ? ' filter-tab--active' : ''}`}
                                onClick={() => { setFilter(t.key); setActive(null); }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="invoices-layout">
                {/* Список накладних */}
                <div className="section-card invoices-list">
                    {list.length === 0
                        ? <div className="empty-state">Накладних немає</div>
                        : list.map(inv => (
                            <button
                                key={inv._id}
                                className={`invoice-card${active?._id === inv._id ? ' invoice-card--active' : ''}`}
                                onClick={() => openInvoice(inv._id)}
                            >
                                <div className="invoice-card-header">
                                    <strong>{inv.number}</strong>
                                    <span className={`badge ${STATUS[inv.status].cls}`}>{STATUS[inv.status].label}</span>
                                </div>
                                <div className="invoice-card-body">
                                    <div>{inv.supplier}</div>
                                    <div className="td-muted">{inv.items.length} позицій • {fmtDateTime(inv.createdAt)}</div>
                                    {inv.linkedOrderNumber && (
                                        <div className="td-muted" style={{ fontSize: '11px' }}>
                                            ↩ за замовленням {inv.linkedOrderNumber}
                                        </div>
                                    )}
                                </div>
                            </button>
                        ))
                    }
                </div>

                {/* Деталі накладної */}
                <div className="section-card invoices-detail">
                    {!active
                        ? <div className="empty-state">Оберіть накладну зліва</div>
                        : (
                            <>
                                <div className="section-card-header">
                                    <div>
                                        <h2 className="section-card-title">{active.number}</h2>
                                        <div className="td-muted">
                                            {active.supplier} • створено {fmtDateTime(active.createdAt)}
                                        </div>
                                        {active.linkedOrderNumber && (
                                            <div className="td-muted" style={{ marginTop: 4 }}>
                                                За замовленням <strong>{active.linkedOrderNumber}</strong>
                                            </div>
                                        )}
                                    </div>
                                    <span className={`badge ${STATUS[active.status].cls}`}>
                                        {STATUS[active.status].label}
                                    </span>
                                </div>

                                {active.note && <div className="alert alert--info">{active.note}</div>}

                                <table className="table">
                                    <thead>
                                    <tr>
                                        <th>Товар</th>
                                        <th>Кат.</th>
                                        <th>Очікується</th>
                                        <th>Фактично</th>
                                        <th>Од.</th>
                                        <th>Вироблено</th>
                                        <th>Термін</th>
                                        <th>Закуп. ціна</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {active.items.map(it => {
                                        const editable = active.status === 'pending';
                                        const val = editedItems[it._id]?.actualQuantity
                                            ?? it.actualQuantity
                                            ?? it.expectedQuantity;
                                        return (
                                            <tr key={it._id}>
                                                <td className="td-name">
                                                    {it.name}
                                                    {it.sku && <div className="td-muted"><code>{it.sku}</code></div>}
                                                </td>
                                                <td>{it.category}</td>
                                                <td>{it.expectedQuantity}</td>
                                                <td>
                                                    {editable
                                                        ? (
                                                            <input
                                                                className="form-input form-input--inline"
                                                                type="number"
                                                                min="0"
                                                                step={it.unit === 'кг' ? '0.01' : '1'}
                                                                value={val}
                                                                onChange={e => setItemQty(it._id, e.target.value)}
                                                            />
                                                        )
                                                        : (it.actualQuantity ?? '—')}
                                                </td>
                                                <td>{it.unit}</td>
                                                <td className="td-date">{fmtDate(it.productionDate)}</td>
                                                <td className="td-date">{fmtDate(it.expiry)}</td>
                                                <td>{Number(it.purchasePrice).toFixed(2)}</td>
                                            </tr>
                                        );
                                    })}
                                    </tbody>
                                </table>

                                {active.status === 'pending' && (
                                    <div className="modal-actions" style={{ marginTop: '1rem' }}>
                                        <button className="btn btn--gray"  onClick={saveDraft}>Зберегти зміни</button>
                                        <button className="btn btn--danger" onClick={reject}>Скасувати накладну</button>
                                        <button className="btn btn--green"  onClick={confirmAccept}>
                                            Прийняти товар на склад
                                        </button>
                                    </div>
                                )}

                                {active.status === 'received' && (
                                    <div className="alert alert--success" style={{ marginTop: '1rem' }}>
                                        Прийнято {fmtDateTime(active.receivedAt)} користувачем {active.receivedBy || '—'}
                                    </div>
                                )}
                            </>
                        )
                    }
                </div>
            </div>
        </div>
    );
}
