const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    expiry: { type: String, required: true },
    dateAdded: { type: Date, default: Date.now }
});

// Забороняємо дублікати по name + expiry
InventorySchema.index({ name: 1, expiry: 1 }, { unique: true });

module.exports = mongoose.model('Inventory', InventorySchema);
