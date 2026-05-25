const { Op, UniqueConstraintError } = require('sequelize');
const { sequelize } = require('./inventory.db');
const Inventory = require('./inventory.model');
const Operation = require('./operation.model');

// REQ-2.2: реєстрація партії
exports.addProduct = async (data) => {
    try {
        const date = data.expiry instanceof Date ? data.expiry : new Date(data.expiry);
        const qty = Number(data.quantity) || 1;
        const productionDate = data.productionDate
            ? (data.productionDate instanceof Date ? data.productionDate : new Date(data.productionDate))
            : null;

        const item = await Inventory.create({
            productId:       data._id || data.productId || null,
            name:            data.name,
            sku:             data.sku || '',
            category:        data.category || 'інше',
            unit:            data.unit || 'шт.',
            expiry:          date,
            productionDate,
            supplier:        data.supplier || '—',
            purchasePrice:   Number(data.purchasePrice) || 0,
            defaultPrice:    Number(data.defaultPrice) || 0,
            quantity:        qty,
            initialQuantity: qty
        });
        return item;
    } catch (e) {
        if (e instanceof UniqueConstraintError) {
            // Дублікат партії (name, expiry, supplier) — агрегуємо у наявну
            const existing = await Inventory.findOne({
                where: {
                    name: data.name,
                    expiry: data.expiry instanceof Date ? data.expiry : new Date(data.expiry),
                    supplier: data.supplier || '—'
                }
            });
            if (existing) {
                const inc = Number(data.quantity) || 1;
                await existing.update({
                    quantity: Number(existing.quantity) + inc,
                    initialQuantity: Number(existing.initialQuantity) + inc,
                    status: existing.status !== 'active' ? 'active' : existing.status
                });
                return existing;
            }
            return null;
        }
        throw e;
    }
};

// Категорії, до яких НЕ застосовуються автоматичні знижки за термінами
// (щоденне поповнення через замовлення — застаріле списується, не уцінюється).
const NO_AUTO_DISCOUNT_CATEGORIES = ['овочі та фрукти', 'випічка та хліб'];

// REQ-Discount-Auto:
// Автоматичний розрахунок знижки за наближенням терміну придатності.
//   • 30 днів → −10%
//   • 20 днів → −25%
//   • 10 днів → −50%
// Викликається на читанні складу, тож знижки завжди свіжі.
function targetDiscountFor(diffDays) {
    if (diffDays < 0)   return 0;          // прострочене не уцінюємо
    if (diffDays <= 10) return 50;
    if (diffDays <= 20) return 25;
    if (diffDays <= 30) return 10;
    return 0;
}

async function autoApplyDiscounts() {
    const now = Date.now();
    const items = await Inventory.findAll({
        where: { status: 'active', quantity: { [Op.gt]: 0 } }
    });
    for (const it of items) {
        if (NO_AUTO_DISCOUNT_CATEGORIES.includes(it.category)) continue;
        const diff = Math.ceil((new Date(it.expiry).getTime() - now) / 86400000);
        const target = targetDiscountFor(diff);
        if (Number(it.discountPercent) !== target) {
            await it.update({
                discountPercent:   target,
                discountAppliedAt: target > 0 ? new Date() : null
            });
        }
    }
}
exports.autoApplyDiscounts = autoApplyDiscounts;

// REQ-2.4: фільтри по категорії, постачальнику, статусу
exports.getProducts = async (filter = {}) => {
    // Самооновлення знижок перед видачею списку — гарантує консистентність UI.
    try { await autoApplyDiscounts(); } catch (e) { /* не критично */ }

    const where = {};
    if (filter.category) where.category = filter.category;
    if (filter.supplier) where.supplier = filter.supplier;
    if (filter.status)   where.status   = filter.status;

    let items = await Inventory.findAll({
        where,
        order: [['expiry', 'ASC'], ['date_added', 'DESC']]
    });

    // Серверний фільтр за станом терміну придатності
    if (filter.expiryState) {
        const now = Date.now();
        items = items.filter(p => {
            const days = Math.ceil((new Date(p.expiry).getTime() - now) / 86400000);
            switch (filter.expiryState) {
                case 'expired':  return days < 0;
                case 'critical': return days >= 0 && days <= 10;
                case 'soon':     return days >= 0 && days <= 30;
                case 'ok':       return days > 30;
                default:         return true;
            }
        });
    }
    return items;
};

// REQ-3.1: продаж за стратегією FEFO
// Атомарна транзакція: списання залишків + запис у журнал.
// Дозволяємо дробові кількості (наприклад 0.132 кг яблук) — точність 0.001.
exports.sellProduct = async (params, user = {}) => {
    const qty = Number(params.quantity);
    if (!isFinite(qty) || qty <= 0) throw new Error('Кількість повинна бути > 0');

    return await sequelize.transaction(async (t) => {
        // Режим 1: продаж конкретної партії
        if (params.batchId) {
            const item = await Inventory.findByPk(params.batchId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!item) throw new Error('Партію не знайдено');
            if (Number(item.quantity) < qty) throw new Error('Недостатня кількість у партії');

            const newQty = Number(item.quantity) - qty;
            await item.update({
                quantity: newQty,
                status: newQty === 0 ? 'sold' : item.status
            }, { transaction: t });

            await Operation.create({
                type: 'sale',
                userId: String(user.id || ''),
                userEmail: user.email || '',
                userRole:  user.role  || '',
                productId: String(item.productId || ''),
                productName: item.name,
                sku:      item.sku,
                category: item.category,
                supplier: item.supplier,
                batchId:  String(item.id),
                quantity: qty,
                // Ціна продажу враховує знижку (REQ: 30/20/10 днів)
                price:    Number(item.defaultPrice) * (1 - Number(item.discountPercent || 0) / 100) || 0
            }, { transaction: t });
            return { items: [item], totalSold: qty };
        }

        // Режим 2: FEFO — обираємо партії за зростанням expiry
        const productKey = params.productName
            ? { name: params.productName }
            : (params.productId ? { productId: params.productId } : null);
        if (!productKey) throw new Error('Вкажіть batchId, productId або productName');

        const candidates = await Inventory.findAll({
            where: {
                ...productKey,
                status: 'active',
                quantity: { [Op.gt]: 0 }
            },
            order: [['expiry', 'ASC']],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const totalAvailable = candidates.reduce((s, p) => s + Number(p.quantity), 0);
        if (totalAvailable < qty) throw new Error('Недостатня кількість на складі');

        let remaining = qty;
        const used = [];
        for (const batch of candidates) {
            if (remaining <= 0) break;
            const available = Number(batch.quantity);
            const take = Math.min(available, remaining);
            const newQty = available - take;
            await batch.update({
                quantity: newQty,
                status: newQty === 0 ? 'sold' : batch.status
            }, { transaction: t });

            await Operation.create({
                type: 'sale',
                userId: String(user.id || ''),
                userEmail: user.email || '',
                userRole:  user.role  || '',
                productId: String(batch.productId || ''),
                productName: batch.name,
                sku:      batch.sku,
                category: batch.category,
                supplier: batch.supplier,
                batchId:  String(batch.id),
                quantity: take,
                price:    Number(batch.defaultPrice) || 0
            }, { transaction: t });
            used.push({ batch, take });
            remaining -= take;
        }
        return { items: used, totalSold: qty };
    });
};

// REQ-3.2: списання з причиною
const VALID_REASONS = ['expired', 'damaged', 'shortage', 'other'];
exports.writeoffProduct = async (params, user = {}) => {
    const qty = Number(params.quantity);
    if (!isFinite(qty) || qty <= 0) throw new Error('Кількість повинна бути > 0');
    const reason = params.reason && VALID_REASONS.includes(params.reason)
        ? params.reason
        : 'other';

    return await sequelize.transaction(async (t) => {
        const item = await Inventory.findByPk(params.batchId || params.productId, {
            transaction: t, lock: t.LOCK.UPDATE
        });
        if (!item) throw new Error('Партію не знайдено');
        if (Number(item.quantity) < qty) throw new Error('Недостатня кількість у партії');

        const newQty = Number(item.quantity) - qty;
        await item.update({
            quantity: newQty,
            status: newQty === 0 ? 'written_off' : item.status
        }, { transaction: t });

        await Operation.create({
            type: 'writeoff',
            userId: String(user.id || ''),
            userEmail: user.email || '',
            userRole:  user.role  || '',
            productId: String(item.productId || ''),
            productName: item.name,
            sku:      item.sku,
            category: item.category,
            supplier: item.supplier,
            batchId:  String(item.id),
            quantity: qty,
            reason,
            note:     params.note || ''
        }, { transaction: t });

        return item;
    });
};

// Запис операції прийому (викликається після addProduct)
exports.recordReceive = async (item, qty, user = {}) => {
    await Operation.create({
        type: 'receive',
        userId: String(user.id || ''),
        userEmail: user.email || '',
        userRole:  user.role  || '',
        productId: String(item.productId || ''),
        productName: item.name,
        sku:      item.sku,
        category: item.category,
        supplier: item.supplier,
        batchId:  String(item.id),
        quantity: qty,
        price:    Number(item.purchasePrice) || 0
    });
};

// REQ-Discount: вручну застосувати знижку до партії (адмін).
// percent = 0..100. 0 знімає знижку. Записуємо момент застосування.
exports.applyDiscount = async (batchId, percent, user = {}) => {
    const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const item = await Inventory.findByPk(batchId);
    if (!item) throw new Error('Партію не знайдено');
    await item.update({
        discountPercent: p,
        discountAppliedAt: p > 0 ? new Date() : null
    });
    return item;
};

// REQ-3.5: повернення продажу касиром.
// Повертає товар у партію (відновлює залишок) і маркує операцію як returned.
// Дозволено: автор продажу (за userEmail) або адмін.
exports.returnSale = async (operationId, user = {}) => {
    return await sequelize.transaction(async (t) => {
        const op = await Operation.findByPk(operationId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!op) throw new Error('Операцію не знайдено');
        if (op.type !== 'sale') throw new Error('Повертати можна лише операції продажу');
        if (op.returned) throw new Error('Цю операцію вже повернено');

        // Доступ: автор продажу або адмін
        const isAdmin = user.role === 'admin';
        if (!isAdmin && op.userEmail !== user.email) {
            throw new Error('Можна повернути лише власну операцію продажу');
        }

        // Знайти партію і відновити залишок
        const batch = await Inventory.findByPk(op.batchId, { transaction: t, lock: t.LOCK.UPDATE });
        if (batch) {
            const restored = Number(batch.quantity) + Number(op.quantity);
            await batch.update({
                quantity: restored,
                // якщо була повністю продана — повертаємо у active
                status: batch.status === 'sold' ? 'active' : batch.status
            }, { transaction: t });
        }
        // Якщо партії немає (наприклад, її видалили) — просто маркуємо операцію.

        await op.update({
            returned:   true,
            returnedAt: new Date(),
            returnedBy: user.email || ''
        }, { transaction: t });

        return op;
    });
};

// REQ-3.4: журнал операцій з фільтрацією
exports.getOperations = async (filter = {}) => {
    const where = {};
    if (filter.userEmail)   where.userEmail = filter.userEmail;
    if (filter.type)        where.type      = filter.type;
    if (filter.productName) where.productName = { [Op.iLike]: `%${filter.productName}%` };
    if (filter.from || filter.to) {
        where.timestamp = {};
        if (filter.from) where.timestamp[Op.gte] = new Date(filter.from);
        if (filter.to)   where.timestamp[Op.lte] = new Date(filter.to);
    }
    return await Operation.findAll({
        where,
        order: [['timestamp', 'DESC']],
        limit: Number(filter.limit) || 500
    });
};
