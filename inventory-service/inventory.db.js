const mongoose = require('mongoose');

const MONGO_URL =
    process.env.INVENTORY_MONGO_URL ||
    "mongodb://inventory-mongo:27017/inventorydb";

async function connectDB() {
    try {
        await mongoose.connect(MONGO_URL);
        console.log("Inventory MongoDB connected");
    } catch (err) {
        console.error("MongoDB connection error:", err.message);
        setTimeout(connectDB, 3000);
    }
}

connectDB();
