const amqp = require('amqplib');
const { connect } = require('./db');
const AnalyticsEvent = require('./analytics.model');

const RABBITMQ_URL = process.env.RABBIT_URL || 'amqp://user:password@rabbitmq:5672';

async function start() {
    // --- CONNECT TO POSTGRES ---
    await connect();

    // --- CONNECT TO RABBITMQ ---
    let conn;
    while (!conn) {
        try {
            conn = await amqp.connect(RABBITMQ_URL);
            console.log('Analytics consumer connected to RabbitMQ');
        } catch {
            console.log('RabbitMQ not ready, retrying in 3s...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    const ch = await conn.createChannel();
    await ch.assertExchange('analytics_exchange', 'topic', { durable: false });

    const q = await ch.assertQueue('', { exclusive: true });
    ch.bindQueue(q.queue, 'analytics_exchange', 'product.*');

    console.log('Analytics Service waiting for events...');

    ch.consume(q.queue, async msg => {
        if (!msg) return;
        try {
            const data = JSON.parse(msg.content.toString());
            const eventType = msg.fields.routingKey;
            console.log('Analytics received:', eventType);

            await AnalyticsEvent.create({
                eventType,
                productId:   data._id ? String(data._id) : null,
                productName: data.name || '',
                sku:         data.sku || '',
                category:    data.category || '',
                supplier:    data.supplier || '',
                reason:      data.reason || '',
                quantity:    Number(data.quantity) || 1
            });

            ch.ack(msg);
        } catch (e) {
            console.error('Analytics processing error:', e.message);
            ch.nack(msg, false, false);
        }
    }, { noAck: false });
}

start();
