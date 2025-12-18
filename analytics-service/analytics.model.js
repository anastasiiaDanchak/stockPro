const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema({
  eventType: { type: String, required: true }, // product.added, product.sold, product.expired
  productId: String,
  quantity: Number,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AnalyticsEvent", analyticsSchema);
