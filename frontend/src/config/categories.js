// ─── Категорії товарів міні-маркета ───────────────────────────────────────
// Єдиний джерельний список для номенклатури, накладних, замовлень
// та фільтрів на складі/касі.
//
// Правила:
//   • perishable      — товар має короткий термін, отримує автоматичні
//                       знижки (30/20/10 днів = 10/25/50%).
//   • allowFractional — допустима дробна кількість (зважування у кг).
//                       За вимогою користувача — ЛИШЕ овочі та фрукти
//                       продаємо у кг, решта — у штуках/упаковках.
//   • Швидкопсувні категорії, які адмін поповнює щодня замовленнями
//     постачальникам (овочі-фрукти, випічка), авто-знижок НЕ отримують.

export const CATEGORIES = [
    { name: 'овочі та фрукти',     unit: 'кг',  allowFractional: true,  perishable: true  },
    { name: 'молочні продукти',    unit: 'шт.', perishable: true  },
    { name: 'мʼясо та ковбаси',    unit: 'шт.', perishable: true  },
    { name: 'випічка та хліб',     unit: 'шт.', perishable: true  },
    { name: 'Напої',               unit: 'шт.', perishable: false },
    { name: 'Крупи та бакалія',    unit: 'шт.', perishable: false },
    { name: 'Солодощі та снеки',   unit: 'шт.', perishable: false },
    { name: 'Заморожені продукти', unit: 'шт.', perishable: true  }
];

// Категорії, на які адмін створює замовлення постачальникам — щоденне поповнення
export const ORDERABLE_CATEGORIES = ['овочі та фрукти', 'випічка та хліб'];

// Категорії, до яких НЕ застосовуються автоматичні знижки за термінами
// (вони щодня поповнюються — застаріле списується, а не уцінюється).
export const NO_AUTO_DISCOUNT_CATEGORIES = ['овочі та фрукти', 'випічка та хліб'];

export const CATEGORY_NAMES = CATEGORIES.map(c => c.name);

export function categoryConfig(name) {
    return CATEGORIES.find(c => c.name === name) || null;
}

export function unitOptionsFor(name) {
    const c = categoryConfig(name);
    if (!c) return ['шт.', 'кг'];
    return c.altUnit ? [c.unit, c.altUnit] : [c.unit];
}

export function isFractionalAllowed(category) {
    return !!categoryConfig(category)?.allowFractional;
}

export function canBeOrdered(category) {
    return ORDERABLE_CATEGORIES.includes(category);
}

export function isAutoDiscountAllowed(category) {
    return !NO_AUTO_DISCOUNT_CATEGORIES.includes(category);
}
