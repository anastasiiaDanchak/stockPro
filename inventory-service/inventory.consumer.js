const amqp = require('amqplib');
const { addProduct } = require('./inventory.controller');

const RABBITMQ_URL = process.env.RABBIT_URL || "amqp://user:password@rabbitmq:5672";

async function start() {
    let conn;
    while (!conn) {
        try {
            conn = await amqp.connect(RABBITMQ_URL);
            console.log("Connected to RabbitMQ");
        } catch (err) {
            console.log("RabbitMQ not ready, retrying in 3s...");
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    const ch = await conn.createChannel();
    await ch.assertExchange('goods_exchange', 'topic', { durable: false });

    const q = await ch.assertQueue('', { exclusive: true });
    ch.bindQueue(q.queue, 'goods_exchange', 'product.new');

    console.log("Inventory Service waiting for events...");

   ch.consume(q.queue, async msg => {
    if (!msg) return;

    try {
        const data = JSON.parse(msg.content.toString());
        const added = await addProduct(data);
        if (added) console.log("Inventory received:", data);
    } catch (e) {
        console.error("Error processing message:", e);
    }
}, { noAck: true });

}

start();
