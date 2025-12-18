const express = require('express');
const amqp = require('amqplib');
const cors = require('cors');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const Product = require('./product.model');

const app = express();
app.use(cors());
app.use(express.json());

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://user:password@rabbitmq:5672';
const INVENTORY_URL = process.env.INVENTORY_URL || 'http://inventory-service:3001/inventory';
const MONGO_URL = process.env.MONGO_URL || 'mongodb://product-mongo:27017/productsdb';

let channel;

// -------------------- CONNECT TO MONGO --------------------
async function connectMongo() {
    while (true) {
        try {
            await mongoose.connect(MONGO_URL);
            console.log("Connected to MongoDB (product-service)");
            break;
        } catch (err) {
            console.log("MongoDB not ready, retrying in 3s...");
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// ---------------- CONNECT TO RABBITMQ ----------------
async function connectRabbit() {
    while (true) {
        try {
            console.log("Connecting to RabbitMQ...");
            const conn = await amqp.connect(RABBIT_URL);
            channel = await conn.createChannel();

            await channel.assertExchange('goods_exchange', 'topic', { durable: false });
            console.log('Connected to RabbitMQ');
            break;
        } catch (err) {
            console.log("RabbitMQ not ready, retrying in 3s...");
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// ---------------- ADD PRODUCT (POST) ----------------
app.post('/add', async (req, res) => {
    const { name, expiry } = req.body;

    if (!name || !expiry) {
        return res.status(400).json({ error: "Заповніть всі поля" });
    }

    const product = { name, expiry, dateAdded: new Date() };

    try {
        // 1. Save to Mongo
        const mongoProduct = await Product.create(product);

        // 2. Publish to RabbitMQ
        channel.publish(
            'analytics_exchange',
            'product.new',
            Buffer.from(JSON.stringify(mongoProduct))
        );

        // 3. Save to inventory-service
        const response = await fetch(INVENTORY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mongoProduct)
        });

        const savedProduct = await response.json();

        res.json({ status: 'Product added', product: savedProduct });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ---------------- START SERVER ----------------
app.listen(3000, async () => {
    await connectMongo();
    await connectRabbit();
    console.log('Product Service running on port 3000');
});
