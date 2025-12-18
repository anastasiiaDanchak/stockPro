const mongoose = require('mongoose');

// Підключення до MongoDB (опції useNewUrlParser та useUnifiedTopology більше не потрібні)
mongoose.connect(process.env.MONGO_URL || 'mongodb://expiration-mongo:27017/expirationdb')
  .then(() => console.log("Connected to Expiration MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

const expirationSchema = new mongoose.Schema({
  productId: String,
  name: String,
  expiry: String,
  diffDays: Number,
  checkedAt: { type: Date, default: Date.now }
});

const Expiration = mongoose.model('Expiration', expirationSchema);

module.exports = Expiration;
