const amqp = require("amqplib");
const mongoose = require("mongoose");
const AnalyticsEvent = require("./analytics.model");

const RABBITMQ_URL = "amqp://user:password@rabbitmq:5672";
const MONGO_URL = process.env.MONGO_URL;

async function start() {
  // --- CONNECT TO MONGO ---
  mongoose.connect(MONGO_URL)
    .then(() => console.log("Analytics MongoDB connected"))
    .catch(err => console.error("Mongo connection error:", err));

  // --- CONNECT TO RABBITMQ ---
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
  await ch.assertExchange("analytics_exchange", "topic", { durable: false });

  const q = await ch.assertQueue("", { exclusive: true });
  ch.bindQueue(q.queue, "analytics_exchange", "product.*");

  console.log("Analytics Service waiting for events...");

  // --- RECEIVE EVENTS ---
  ch.consume(q.queue, async msg => {
    const data = JSON.parse(msg.content.toString());
    console.log("Analytics received:", data);

    // Save event to DB
    await AnalyticsEvent.create({
      eventType: msg.fields.routingKey,
      productId: data._id, // використати _id з продукту
      quantity: data.quantity || 1
    });


  }, { noAck: true });
}

start();
