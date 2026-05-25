import { useState, useContext, useMemo } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import useOrders from '../../hooks/useOrders';
import { addProduct } from '../../api/api';

const STATUS_LABELS = {
    pending:   { label: 'Очікується', cls: 'badge--warning' },
    received:  { label: 'Прийнято',   cls: 'badge--green'   },
    cancelled: { label: 'Скасовано',  cls: 'badge--gray'    }
};

const emptyItem = () => ({ name: '', expiry: '', quantity: 1 });

export default function Orders() {
    const { user } = useContext(AuthContext);
    const { orders, addOrder, updateOrder, removeOrder } = useOrders();

    // ── Форма створення замовлення (UC3) ─────────────────────────────
    const [showForm, setShowForm] = useState(false);
    const [supplier, setSupplier] = useState('');
    const [note, setNote] = useState('');
    const [items, setItems] = useState([emptyItem()]);
    const [formError, setFormError] = useState('');

    // ── Стан прийому замовлення (UC2) ────────────────────────────────
    const [receivingId, setReceivingId] = useState(null);
    const [globalError, setGlobalError] = useState('');
    const [globalSuccess, setGlobalSuccess] = useState('');

    // ── Фільтр ───────────────────────────────────────────────────────
    const [filter, setFilter] = useState('all');

    const filteredOrders = useMemo(() => {
        if (filter === 'all') return orders;
        return orders.filter(o => o.status === filter);
    }, [orders, filter]);

    const counts = useMemo(() => ({
        all:       orders.length,
        pending:   orders.filter(o => o.status === 'pending').length,
        received:  orders.filter(o => o.status === 'received').length,
        cancelled: orders.filter(o => o.status === 'cancelled').length
    }), [orders]);

    // ── Створити замовлення ─────────────────────────────────────────
    const updateItem = (idx, patch) => {
        setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    };

    const handleAddItem = () => setItems([...items, emptyItem()]);

    const handleRemoveItem = (idx) => {
        if (items.length === 1) return;
        setItems(items.filter((_, i) => i !== idx));
    };

    const resetForm = () => {
        setSupplier('');
        setNote('');
        setItems([emptyItem()]);
        setFormError('');
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setFormError('');

        if (!supplier.trim()) {
            setFormError('Вкажіть постачальника');
            return;
        }
        const cleanItems = items
            .map(it => ({
                name:     it.name.trim(),
                expiry:   it.expiry,
                quantity: Number(it.quantity)
            }))
            .filter(it => it.name && it.expiry && it.quantity > 0);

        if (cleanItems.length === 0) {
            setFormError('Додайте хоча б одну позицію (назва, термін, кількість)');
            return;
        }

        addOrder({ supplier: supplier.trim(), note: note.trim(), items: cleanItems });
        setGlobalSuccess(`Замовлення для "${supplier.trim()}" створено`);
        setTimeout(() => setGlobalSuccess(''), 3000);
        resetForm();
        setShowForm(false);
    };

    // ── Прийняти замовлення (UC2) ───────────────────────────────────
    const handleReceive = async (order) => {
        if (!user?.token) return;
        setReceivingId(order.id);
        setGlobalError('');

        try {
            const results = await Promise.all(
                order.items.map(it =>
                    addProduct(user.token, {
                        name:     it.name,
                        expiry:   it.expiry,
                        quantity: it.quantity
                    }).catch(err => ({ error: err.message || 'Помилка' }))
                )
            );

            const errors = results.filter(r => r?.error);
            if (errors.length === order.items.length) {
                setGlobalError(`Не вдалося прийняти товар: ${errors[0].error}`);
                return;
            }

            updateOrder(order.id, {
                status: 'received',
                receivedAt: new Date().toISOString()
            });

            if (errors.length > 0) {
                setGlobalSuccess(
                    `Прийнято з помилками: ${order.items.length - errors.length}/${order.items.length} позицій`
                );
            } else {
                setGlobalSuccess(`Замовлення №${order.id.slice(-5)} повністю прийнято на склад`);
            }
            setTimeout(() => setGlobalSuccess(''), 3500);
        } catch (e) {
            setGlobalError(e.message || 'Помилка під час прийому');
        } finally {
            setReceivingId(null);
        }
    };

    const handleCancel = (order) => {
        if (!window.confirm(`Скасувати замовлення для "${order.supplier}"?`)) return;
        updateOrder(order.id, { status: 'cancelled' });
    };

    const handleDelete = (order) => {
        if (!window.confirm('Видалити запис назавжди?')) return;
        removeOrder(order.id);
    };

    const totalQty = (order) => order.items.reduce((s, it) => s + Number(it.quantity || 0), 0);

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Замовлення на постачання</h1>
                    <p className="page-subtitle">
                        Створення замовлень постачальникам та прийом товару на склад
                    </p>
                </div>
                <button
                    className="btn btn--primary"
                    onClick={() => { setShowForm(!showForm); setFormError(''); }}
                >
                    {showForm ? '✕ Скасувати' : '+ Нове замовлення'}
                </button>
            </div>

            {globalSuccess && <div className="alert alert--success">{globalSuccess}</div>}
            {globalError   && <div className="alert alert--danger">{globalError}</div>}

            {/* ── UC3: Форма створення ────────────────────── */}
            {showForm && (
                <div className="section-card section-card--form">
                    <h2 className="section-card-title" style={{ marginBottom: '1rem' }}>
                        Нове замовлення
                    </h2>
                    <form onSubmit={handleSubmit}>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Постачальник *</label>
                                <input
                                    className="form-input"
                                    value={supplier}
                                    onChange={e => setSupplier(e.target.value)}
                                    placeholder='Напр.: ТОВ "Молокопродукт"'
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Примітка</label>
                                <input
                                    className="form-input"
                                    value={note}
                                    onChange={e => setNote(e.target.value)}
                                    placeholder="Договір №, контактна особа..."
                                />
                            </div>
                        </div>

                        <div className="order-items">
                            <div className="order-items-header">
                                <span className="form-label" style={{ margin: 0 }}>Позиції</span>
                                <button
                                    type="button"
                                    className="btn btn--sm btn--outline"
                                    onClick={handleAddItem}
                                >
                                    + Додати позицію
                                </button>
                            </div>
                            {items.map((it, idx) => (
                                <div className="order-item-row" key={idx}>
                                    <input
                                        className="form-input"
                                        placeholder="Назва товару"
                                        value={it.name}
                                        onChange={e => updateItem(idx, { name: e.target.value })}
                                    />
                                    <input
                                        className="form-input"
                                        type="date"
                                        value={it.expiry}
                                        onChange={e => updateItem(idx, { expiry: e.target.value })}
                                    />
                                    <input
                                        className="form-input"
                                        type="number"
                                        min="1"
                                        value={it.quantity}
                                        onChange={e => updateItem(idx, { quantity: Number(e.target.value) })}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn--sm btn--gray"
                                        onClick={() => handleRemoveItem(idx)}
                                        disabled={items.length === 1}
                                        title="Видалити позицію"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>

                        {formError && (
                            <div className="alert alert--danger" style={{ marginTop: '1rem' }}>
                                {formError}
                            </div>
                        )}

                        <div className="form-actions" style={{ marginTop: '1rem' }}>
                            <button type="button" className="btn btn--outline" onClick={resetForm}>
                                Очистити
                            </button>
                            <button type="submit" className="btn btn--primary">
                                Створити замовлення
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── Фільтри ───────────────────────────────────── */}
            <div className="filter-bar">
                <div className="filter-tabs">
                    {[
                        { key: 'all',       label: 'Усі' },
                        { key: 'pending',   label: 'Очікуються' },
                        { key: 'received',  label: 'Прийняті' },
                        { key: 'cancelled', label: 'Скасовані' }
                    ].map(f => (
                        <button
                            key={f.key}
                            className={`filter-tab${filter === f.key ? ' filter-tab--active' : ''}`}
                            onClick={() => setFilter(f.key)}
                        >
                            {f.label} <span className="filter-tab-count">{counts[f.key]}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Список замовлень ───────────────────────────── */}
            <div className="orders-list">
                {filteredOrders.length === 0 ? (
                    <div className="section-card">
                        <div className="empty-state">
                            {orders.length === 0
                                ? 'Замовлень ще немає. Створіть перше!'
                                : 'У цій категорії замовлень немає'}
                        </div>
                    </div>
                ) : (
                    filteredOrders.map(order => {
                        const statusInfo = STATUS_LABELS[order.status] || STATUS_LABELS.pending;
                        const isReceiving = receivingId === order.id;
                        return (
                            <div className="order-card" key={order.id}>
                                <div className="order-card-header">
                                    <div>
                                        <div className="order-card-title">
                                            {order.supplier}
                                            <span className={`badge ${statusInfo.cls}`} style={{ marginLeft: 12 }}>
                                                {statusInfo.label}
                                            </span>
                                        </div>
                                        <div className="order-card-meta">
                                            №{order.id.slice(-5)} · створено{' '}
                                            {new Date(order.createdAt).toLocaleString('uk-UA')}
                                            {order.receivedAt && (
                                                <> · прийнято {new Date(order.receivedAt).toLocaleString('uk-UA')}</>
                                            )}
                                        </div>
                                        {order.note && (
                                            <div className="order-card-note">{order.note}</div>
                                        )}
                                    </div>
                                    <div className="order-card-actions">
                                        {order.status === 'pending' && (
                                            <>
                                                <button
                                                    className="btn btn--green"
                                                    onClick={() => handleReceive(order)}
                                                    disabled={isReceiving}
                                                >
                                                    {isReceiving ? 'Прийом...' : '✓ Прийняти товар'}
                                                </button>
                                                <button
                                                    className="btn btn--outline"
                                                    onClick={() => handleCancel(order)}
                                                    disabled={isReceiving}
                                                >
                                                    Скасувати
                                                </button>
                                            </>
                                        )}
                                        {order.status !== 'pending' && (
                                            <button
                                                className="btn btn--sm btn--gray"
                                                onClick={() => handleDelete(order)}
                                            >
                                                Видалити
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <table className="table table--compact">
                                    <thead>
                                        <tr>
                                            <th>Товар</th>
                                            <th>Термін придатності</th>
                                            <th style={{ textAlign: 'right' }}>Кількість</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {order.items.map((it, i) => (
                                            <tr key={i}>
                                                <td className="td-name">{it.name}</td>
                                                <td>{new Date(it.expiry).toLocaleDateString('uk-UA')}</td>
                                                <td style={{ textAlign: 'right' }}>{it.quantity} шт.</td>
                                            </tr>
                                        ))}
                                        <tr className="order-total-row">
                                            <td colSpan="2"><strong>Усього позицій: {order.items.length}</strong></td>
                                            <td style={{ textAlign: 'right' }}>
                                                <strong>{totalQty(order)} шт.</strong>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
