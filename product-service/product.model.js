const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: String,
    expiry: String,
    dateAdded: Date
});

module.exports = mongoose.model('Product', ProductSchema);
