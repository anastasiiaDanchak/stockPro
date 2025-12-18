const axios = require('axios');
const amqp = require('amqplib');
const Expiration = require('./db');

const RABBIT_URL = process.env.RABBIT_URL || "amqp://user:password@rabbitmq:5672";
let channel;

async function connectRabbit() {
    if (channel) return;
    try {
        const conn = await amqp.connect(RABBIT_URL);
        conn.on("error", err => console.error("RabbitMQ connection error:", err));
        conn.on("close", () => {
            console.log("RabbitMQ connection closed. Reconnecting...");
            channel = null;
            setTimeout(connectRabbit, 3000);
        });

        channel = await conn.createChannel();
        await channel.assertExchange('goods_exchange', 'topic', { durable: false });
        console.log("Connected to RabbitMQ");
    } catch (err) {
        console.log("RabbitMQ not ready, retrying in 3s...");
        await new Promise(r => setTimeout(connectRabbit, 3000));
        await connectRabbit();
    }
}

async function publish(msg, key) {
    if (!channel) await connectRabbit();
    channel.publish('goods_exchange', key, Buffer.from(JSON.stringify(msg)));
}

// Логіка перевірки термінів
async function checkExpirationsLogic() {
    const res = await axios.get("http://inventory-service:3001/inventory");
    const products = res.data;

    const now = Date.now();
    const result = { "30": [], "20": [], "10": [] };

    for (const p of products) {
        const expiryTS = Date.parse(p.expiry);
        const diffDays = Math.ceil((expiryTS - now) / (1000 * 60 * 60 * 24));

        // Зберігаємо перевірку в БД
        await Expiration.create({
            productId: p._id,
            name: p.name,
            expiry: p.expiry,
            diffDays
        });

        if (diffDays < 0) {
            await publish(p, "product.expired");
            continue;
        }

        if (diffDays <= 10) result["10"].push(p);
        else if (diffDays <= 20) result["20"].push(p);
        else if (diffDays <= 30) result["30"].push(p);
    }

    return result;
}

exports.checkExpirations = async () => {
    return await checkExpirationsLogic();
};
