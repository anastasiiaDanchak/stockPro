import { useEffect, useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import {
    getSupplyOrders, createSupplyOrder, updateSupplyOrder, cancelSupplyOrder,
    getSupplySettings, simulateDelivery, getCatalog
} from '../../api/api';
import { unitOptionsFor } from '../../config/categories';

const STATUS = {
    draft:     { label: 'Чернетка',  cls: 'badge--gray'    },
    sent:      { label: 'Надіслано', cls: 'badge--blue'    },
    delivered: { label: 'Доставлено', cls: 'badge--orange' },
    received:  { label: 'Отримано',  cls: 'badge--green'   },
    cancelled: { label: 'Скасовано', cls: 'badge--gray'    }
};

function fmtDateTime(d) {
    return d ? new Date(d).toLocaleString('uk-UA') : '—';
}

const emptyItem = (cat = '', unit = 'шт.') => ({
    name: '', sku: '', category: cat, unit, quantity: '', note: ''
});

// Замовлення на постачання — лише для швидкопсувних категорій (з налаштувань).
// Кількість вводиться вручну текстом (без стрілочок), одиниця залежить від категорії.
export default function SupplyOrders() {
    const { user } = useContext(AuthContext);

    const [orders, setOrders]       = useState([]);
    const [settings, setSettings]   = useState(null);
    const [catalog, setCatalog]     = useState([]);    // номенклатура для пропозицій
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [success, setSuccess]     = useState('');
    const [filter, setFilter]       = useState('all');

    const [showForm, setShowForm]   = useState(false);
    const [supplier, setSupplier]   = useState('');
    const [note, setNote]           = useState('');
    const [items, setItems]         = useState([emptyItem()]);

    const reload = async () => {
        try {
            const [list, s, cat] = await Promise.all([
                getSupplyOrders(user.token, {}),
                getSupplySettings(user.token).catch(() => null),
                getCatalog(user.token, { active: 'true' }).catch(() => [])
            ]);
            setOrders(Array.isArray(list) ? list : []);
            setSettings(s);
            setCatalog(Array.isArray(cat) ? cat : []);
            // первинна одиниця у формі — за першою категорією зі списку
            if (s?.perishableCategories?.length && items.length === 1 && !items[0].category) {
                const c = s.perishableCategories[0];
                setItems([emptyItem(c.name, c.unit)]);
            }
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (user) reload(); /* eslint-disable-next-line */ }, [user]);

    const filteredOrders = useMemo(() => {
        if (filter === 'all') return orders;
        return orders.filter(o => o.status === filter);
    }, [orders, filter]);

    const counts = useMemo(() => ({
        all:       orders.length,
        draft:     orders.filter(o => o.status === 'draft').length,
        sent:      orders.filter(o => o.status === 'sent').length,
        delivered: orders.filter(o => o.status === 'delivered').length,
        cancelled: orders.filter(o => o.status === 'cancelled').length
    }), [orders]);

    // ── Робота з позиціями форми ────────────────────────
    const updateItem = (idx, patch) => {
        setItems(items.map((it, i) => {
            if (i !== idx) return it;
            const next = { ...it, ...patch };
            // якщо змінилася категорія — підтягнути одиницю з налаштувань
            if (patch.category !== undefined) {
                const cat = settings?.perishableCategories?.find(c => c.name === patch.category);
                if (cat) next.unit = cat.unit;
            }
            return next;
        }));
    };

    const addRow = () => {
        const c = settings?.perishableCategories?.[0];
        setItems([...items, emptyItem(c?.name, c?.unit || 'шт.')]);
    };

    const removeRow = (idx) => {
        if (items.length === 1) return;
        setItems(items.filter((_, i) => i !== idx));
    };

    const reset = () => {
        const c = settings?.perishableCategories?.[0];
        setSupplier(''); setNote('');
        setItems([emptyItem(c?.name, c?.unit || 'шт.')]);
        setShowForm(false);
    };

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (!supplier.trim()) { setError('Вкажіть постачальника'); return; }

        const cleanItems = items
            .map(it => ({
                name:     String(it.name).trim(),
                sku:      String(it.sku).trim(),
                category: String(it.category).trim(),
                unit:     it.unit,
                quantity: Number(String(it.quantity).replace(',', '.')) || 0,
                note:     String(it.note).trim()
            }))
            .filter(it => it.name && it.category && it.quantity > 0);

        if (cleanItems.length === 0) {
            setError('Додайте хоча б одну позицію (назва, категорія, кількість)');
            return;
        }

        try {
            await createSupplyOrder(user.token, {
                supplier: supplier.trim(),
                note: note.trim(),
                items: cleanItems
            });
            setSuccess('Замовлення створено');
            setTimeout(() => setSuccess(''), 3000);
            reset();
            await reload();
        } catch (e) { setError(e.message); }
    };

    const sendOrder = async (order) => {
        try {
            await updateSupplyOrder(user.token, order._id, { status: 'sent' });
            setSuccess(`Замовлення ${order.number} надіслано`);
            setTimeout(() => setSuccess(''), 2500);
            await reload();
        } catch (e) { setError(e.message); }
    };

    const cancel = async (order) => {
        if (!window.confirm(`Скасувати ${order.number}?`)) return;
        try {
            await cancelSupplyOrder(user.token, order._id);
            await reload();
        } catch (e) { setError(e.message); }
    };

    const accelerate = async (order) => {
        try {
            const result = await simulateDelivery(user.token, order._id);
            setSuccess(`Доставлено: накладна ${result.invoice?.number || ''}`);
            setTimeout(() => setSuccess(''), 3000);
            await reload();
        } catch (e) { setError(e.message); }
    };

    // Підказки для назви товару: тільки ті позиції, що належать до однієї
    // з категорій, на які можна замовляти (щоб не пропонувати безглузде).
    const orderableCatNames = useMemo(
        () => (settings?.perishableCategories || []).map(c => c.name),
        [settings]
    );

    // Пропозиції для конкретного рядка форми — звужуємо за обраною категорією,
    // якщо вона вказана. Без категорії — підказуємо весь дозволений каталог.
    const suggestionsFor = (cat) => {
        if (!catalog || catalog.length === 0) return [];
        return catalog
            .filter(c => orderableCatNames.includes(c.category))
            .filter(c => !cat || c.category === cat);
    };

    if (loading) return <div className="page-loading">Завантаження...</div>;

    const cats = settings?.perishableCategories || [];
    const suppliers = settings?.suppliers || [];

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Замовлення</h1>
                    <p className="page-subtitle">
                        Замовлення постачальникам — тільки на швидкопсувні категорії:
                        {' '}{cats.map(c => c.name).join(', ') || '—'}.
                    </p>
                </div>
                <button className="btn btn--primary" onClick={() => setShowForm(!showForm)}>
                    {showForm ? '✕ Скасувати' : '+ Нове замовлення'}
                </button>
            </div>

            {error   && <div className="alert alert--danger">{error}</div>}
            {success && <div className="alert alert--success">{success}</div>}

            {showForm && (
                <div className="section-card section-card--form">
                    <h2 className="section-card-title" style={{ marginBottom: '1rem' }}>Нове замовлення</h2>
                    <form onSubmit={submit}>
                        <div className="inline-form" style={{ marginBottom: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">Постачальник</label>
                                {/* Випадаючий список — щоб не вводити постачальника
                                    вручну і не помилитись. Адмін додає нових
                                    у вкладці «Налаштування». */}
                                <select className="form-input" value={supplier}
                                        onChange={e => setSupplier(e.target.value)} required>
                                    <option value="">— оберіть постачальника —</option>
                                    {suppliers.map(s => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                                {suppliers.length === 0 && (
                                    <div className="td-muted" style={{ fontSize: 11, marginTop: 4 }}>
                                        Список порожній — додайте у Налаштуваннях.
                                    </div>
                                )}
                            </div>
                            <div className="form-group" style={{ gridColumn: '1/-1' }}>
                                <label className="form-label">Примітка</label>
                                <input className="form-input" value={note}
                                       onChange={e => setNote(e.target.value)} />
                            </div>
                        </div>

                        <table className="table">
                            <thead>
                            <tr>
                                <th>Категорія</th>
                                <th>Назва</th>
                                <th>SKU</th>
                                <th>Кількість</th>
                                <th>Од.</th>
                                <th>Примітка</th>
                                <th></th>
                            </tr>
                            </thead>
                            <tbody>
                            {items.map((it, i) => (
                                <tr key={i}>
                                    <td>
                                        <select className="form-input form-input--inline"
                                                value={it.category}
                                                onChange={e => updateItem(i, { category: e.target.value })}>
                                            {cats.length === 0 && <option value="">—</option>}
                                            {cats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                        </select>
                                    </td>
                                    <td>
                                        {/* Datalist підказує товари з каталогу.
                                            При співпадінні з пропозицією — автоматично
                                            підтягуємо SKU, категорію та одиницю. */}
                                        <input className="form-input form-input--inline"
                                               list={`catalog-list-${i}`}
                                               value={it.name}
                                               onChange={e => {
                                                   const v = e.target.value;
                                                   const m = catalog.find(c => c.name === v);
                                                   if (m) {
                                                       updateItem(i, {
                                                           name: v,
                                                           sku: m.sku || it.sku,
                                                           category: m.category || it.category,
                                                           unit: m.unit || it.unit
                                                       });
                                                   } else {
                                                       updateItem(i, { name: v });
                                                   }
                                               }}
                                               placeholder="Почніть вводити..."
                                               autoComplete="off" />
                                        <datalist id={`catalog-list-${i}`}>
                                            {suggestionsFor(it.category).map(c => (
                                                <option key={c._id || c.sku || c.name}
                                                        value={c.name}>
                                                    {c.sku ? `${c.sku} • ` : ''}{c.category}
                                                </option>
                                            ))}
                                        </datalist>
                                    </td>
                                    <td>
                                        <input className="form-input form-input--inline"
                                               value={it.sku}
                                               readOnly={!!catalog.find(c => c.name === it.name)}
                                               onChange={e => updateItem(i, { sku: e.target.value })}
                                               placeholder="—" />
                                    </td>
                                    <td>
                                        {/* type=text навмисно — щоб без стрілочок-крутилок */}
                                        <input className="form-input form-input--inline form-input--qty"
                                               type="text"
                                               inputMode="decimal"
                                               value={it.quantity}
                                               onChange={e => updateItem(i, { quantity: e.target.value })}
                                               placeholder={it.unit === 'кг' ? '12.5' : '20'} />
                                    </td>
                                    <td>
                                        {/* Дозволяємо вибрати кг або шт. — наприклад, авокадо чи манго
                                            адмін зазвичай замовляє поштучно. */}
                                        {(() => {
                                            const opts = unitOptionsFor(it.category);
                                            const allUnits = opts.length > 1 ? opts : ['шт.', 'кг'];
                                            return (
                                                <select className="form-input form-input--inline"
                                                        value={it.unit}
                                                        onChange={e => updateItem(i, { unit: e.target.value })}
                                                        style={{ minWidth: 70 }}>
                                                    {allUnits.map(u => (
                                                        <option key={u} value={u}>{u}</option>
                                                    ))}
                                                </select>
                                            );
                                        })()}
                                    </td>
                                    <td>
                                        <input className="form-input form-input--inline"
                                               value={it.note}
                                               onChange={e => updateItem(i, { note: e.target.value })} />
                                    </td>
                                    <td>
                                        <button type="button" className="btn btn--sm btn--gray"
                                                onClick={() => removeRow(i)} disabled={items.length === 1}>
                                            ✕
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>

                        <div className="form-actions" style={{ marginTop: '1rem' }}>
                            <button type="button" className="btn btn--gray" onClick={addRow}>+ Позиція</button>
                            <button type="submit" className="btn btn--primary">Створити замовлення</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="filter-bar">
                <div className="filter-tabs">
                    {[
                        { key: 'all',       label: `Усі (${counts.all})` },
                        { key: 'draft',     label: `Чернетки (${counts.draft})` },
                        { key: 'sent',      label: `Надіслано (${counts.sent})` },
                        { key: 'delivered', label: `Доставлено (${counts.delivered})` },
                        { key: 'cancelled', label: `Скасовані (${counts.cancelled})` }
                    ].map(t => (
                        <button key={t.key}
                                className={`filter-tab${filter === t.key ? ' filter-tab--active' : ''}`}
                                onClick={() => setFilter(t.key)}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="section-card">
                {filteredOrders.length === 0
                    ? <div className="empty-state">Замовлень немає</div>
                    : (
                        <table className="table">
                            <thead>
                            <tr>
                                <th>№</th>
                                <th>Постачальник</th>
                                <th>Позиції</th>
                                <th>Створено</th>
                                <th>Надіслано</th>
                                <th>Статус</th>
                                <th>Дії</th>
                            </tr>
                            </thead>
                            <tbody>
                            {filteredOrders.map(o => (
                                <tr key={o._id}>
                                    <td><strong>{o.number}</strong></td>
                                    <td>{o.supplier}</td>
                                    <td>
                                        {o.items.map((it, i) => (
                                            <div key={i} className="td-muted" style={{ fontSize: '12px' }}>
                                                {it.name} — {it.quantity} {it.unit} <em>({it.category})</em>
                                            </div>
                                        ))}
                                    </td>
                                    <td className="td-date">{fmtDateTime(o.createdAt)}</td>
                                    <td className="td-date">{fmtDateTime(o.sentAt)}</td>
                                    <td>
                                        <span className={`badge ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                                        {o.linkedInvoiceNumber && (
                                            <div className="td-muted" style={{ fontSize: '11px', marginTop: 4 }}>
                                                → накладна <strong>{o.linkedInvoiceNumber}</strong>
                                            </div>
                                        )}
                                    </td>
                                    <td>
                                        <div className="action-btns">
                                            {o.status === 'draft' && (
                                                <button className="btn btn--sm btn--green" onClick={() => sendOrder(o)}>
                                                    Надіслати
                                                </button>
                                            )}
                                            {o.status === 'sent' && (
                                                <button className="btn btn--sm btn--blue" onClick={() => accelerate(o)} title="Симулювати приїзд постачальника">
                                                    ⏩ Прискорити доставку
                                                </button>
                                            )}
                                            {(o.status === 'draft' || o.status === 'sent') && (
                                                <button className="btn btn--sm btn--gray" onClick={() => cancel(o)}>
                                                    Скасувати
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
            </div>
        </div>
    );
}
