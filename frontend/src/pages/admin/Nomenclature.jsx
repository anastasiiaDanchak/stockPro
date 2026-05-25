import { useEffect, useState, useContext } from 'react';
import { AuthContext } from '../../auth/AuthContext';
import {
    getCatalog, createCatalogItem, updateCatalogItem, deactivateCatalogItem
} from '../../api/api';
import { CATEGORY_NAMES, unitOptionsFor, categoryConfig } from '../../config/categories';

// REQ-2.1: довідник номенклатури — додавання, редагування, деактивація
export default function Nomenclature() {
    const { user } = useContext(AuthContext);
    const [items, setItems]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [success, setSuccess] = useState('');
    const [filter, setFilter]   = useState({ search: '', category: '', active: '' });

    const empty = { name: '', sku: '', category: '', unit: 'шт.', defaultPrice: 0, description: '' };
    const [form, setForm]       = useState(empty);
    const [editing, setEditing] = useState(null);
    const [showForm, setShowForm] = useState(false);

    const load = async () => {
        try {
            const data = await getCatalog(user.token, {});
            setItems(Array.isArray(data) ? data : []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (user) load(); }, [user]);

    const submit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess('');
        try {
            if (editing) {
                await updateCatalogItem(user.token, editing._id, form);
                setSuccess('Позицію оновлено');
            } else {
                await createCatalogItem(user.token, form);
                setSuccess('Позицію створено');
            }
            setForm(empty); setEditing(null); setShowForm(false);
            await load();
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) {
            setError(e.message);
        }
    };

    const onEdit = (item) => {
        setEditing(item);
        setForm({
            name: item.name,
            sku: item.sku,
            category: item.category,
            unit: item.unit,
            defaultPrice: item.defaultPrice,
            description: item.description || ''
        });
        setShowForm(true);
    };

    const onDeactivate = async (item) => {
        if (!window.confirm(`Деактивувати "${item.name}"?`)) return;
        try {
            await deactivateCatalogItem(user.token, item._id);
            setSuccess('Позицію деактивовано');
            await load();
            setTimeout(() => setSuccess(''), 3000);
        } catch (e) { setError(e.message); }
    };

    const filtered = items.filter(it => {
        if (filter.search && !`${it.name} ${it.sku}`.toLowerCase().includes(filter.search.toLowerCase())) return false;
        if (filter.category && it.category !== filter.category) return false;
        if (filter.active === 'active'   && !it.isActive) return false;
        if (filter.active === 'inactive' &&  it.isActive) return false;
        return true;
    });

    const categories = Array.from(new Set(items.map(i => i.category).filter(Boolean))).sort();

    if (loading) return <div className="page-loading">Завантаження...</div>;

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Номенклатура</h1>
                    <p className="page-subtitle">{items.length} позицій у довіднику</p>
                </div>
                <button className="btn btn--primary" onClick={() => {
                    setForm(empty); setEditing(null); setShowForm(!showForm);
                }}>
                    {showForm ? '✕ Скасувати' : '+ Додати позицію'}
                </button>
            </div>

            {error   && <div className="alert alert--danger">{error}</div>}
            {success && <div className="alert alert--success">{success}</div>}

            {showForm && (
                <div className="section-card section-card--form">
                    <h2 className="section-card-title" style={{ marginBottom: '1rem' }}>
                        {editing ? 'Редагування позиції' : 'Нова позиція'}
                    </h2>
                    <form onSubmit={submit} className="inline-form">
                        <div className="form-group">
                            <label className="form-label">Найменування</label>
                            <input className="form-input" required value={form.name}
                                   onChange={e => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Артикул (SKU)</label>
                            <input className="form-input" required value={form.sku}
                                   onChange={e => setForm({ ...form, sku: e.target.value })} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Категорія</label>
                            {/* Фіксований список — щоб не виникало дублікатів
                                на кшталт «овочі-фрукти» і «овочі та фрукти». */}
                            <select className="form-input" required value={form.category}
                                    onChange={e => {
                                        const cat = e.target.value;
                                        const cfg = categoryConfig(cat);
                                        setForm({
                                            ...form,
                                            category: cat,
                                            unit: cfg ? cfg.unit : form.unit
                                        });
                                    }}>
                                <option value="">— оберіть —</option>
                                {CATEGORY_NAMES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Одиниця виміру</label>
                            <select className="form-input" value={form.unit}
                                    onChange={e => setForm({ ...form, unit: e.target.value })}>
                                {(form.category ? unitOptionsFor(form.category) : ['шт.', 'кг']).map(u => (
                                    <option key={u} value={u}>{u}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Ціна за замовчуванням</label>
                            <input className="form-input" type="number" min="0" step="0.01"
                                   value={form.defaultPrice}
                                   onChange={e => setForm({ ...form, defaultPrice: Number(e.target.value) })} />
                        </div>
                        <div className="form-group" style={{ gridColumn: '1/-1' }}>
                            <label className="form-label">Опис</label>
                            <input className="form-input" value={form.description}
                                   onChange={e => setForm({ ...form, description: e.target.value })} />
                        </div>
                        <div className="form-actions">
                            <button className="btn btn--primary" type="submit">
                                {editing ? 'Оновити' : 'Створити'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="filter-bar">
                <input
                    className="filter-search"
                    placeholder="Пошук назви або артикулу..."
                    value={filter.search}
                    onChange={e => setFilter({ ...filter, search: e.target.value })}
                />
                <select className="filter-search" value={filter.category}
                        onChange={e => setFilter({ ...filter, category: e.target.value })}>
                    <option value="">Усі категорії</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="filter-tabs">
                    {[{ key: '', label: 'Усі' }, { key: 'active', label: 'Активні' }, { key: 'inactive', label: 'Неактивні' }].map(t => (
                        <button key={t.key}
                                className={`filter-tab${filter.active === t.key ? ' filter-tab--active' : ''}`}
                                onClick={() => setFilter({ ...filter, active: t.key })}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="section-card">
                {filtered.length === 0
                    ? <div className="empty-state">Позицій не знайдено</div>
                    : (
                        <table className="table">
                            <thead>
                            <tr>
                                <th>Артикул</th>
                                <th>Найменування</th>
                                <th>Категорія</th>
                                <th>Од.</th>
                                <th>Ціна</th>
                                <th>Статус</th>
                                <th>Дії</th>
                            </tr>
                            </thead>
                            <tbody>
                            {filtered.map(it => (
                                <tr key={it._id} className={!it.isActive ? 'tr--muted' : ''}>
                                    <td><code>{it.sku}</code></td>
                                    <td className="td-name">{it.name}</td>
                                    <td>{it.category}</td>
                                    <td>{it.unit}</td>
                                    <td>{Number(it.defaultPrice).toFixed(2)}</td>
                                    <td>{it.isActive
                                        ? <span className="badge badge--green">активна</span>
                                        : <span className="badge badge--gray">деактивована</span>}</td>
                                    <td>
                                        <div className="action-btns">
                                            <button className="btn btn--sm btn--gray" onClick={() => onEdit(it)}>
                                                Редагувати
                                            </button>
                                            {it.isActive && (
                                                <button className="btn btn--sm btn--danger" onClick={() => onDeactivate(it)}>
                                                    Деактивувати
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
