const Inventory = require('./inventory.model');

/**
 * Додає продукт (унікальний по name + expiry).
 * Повертає доданий продукт або null, якщо дублікат.
 */
exports.addProduct = async ({ name, expiry }) => {
    try {
        const item = await Inventory.create({ name, expiry });
        return item;
    } catch (e) {
        if (e.code === 11000) {
            // дублікат
            return null;
        }
        throw e;
    }
};

exports.getProducts = async () => {
    return await Inventory.find().sort({ dateAdded: -1 });
};
