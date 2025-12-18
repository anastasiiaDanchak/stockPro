require("./tracing");
const express = require("express");
const cors = require("cors");
require("./analytics.consumer"); // запускає RabbitMQ listener

const AnalyticsEvent = require("./analytics.model");

const app = express();
app.use(cors());

// Загальна кількість подій по типах
app.get("/stats", async (req, res) => {
  const stats = await AnalyticsEvent.aggregate([
    { $group: { _id: "$eventType", count: { $sum: 1 } } }
  ]);

  res.json(stats);
});

// Аналіз продажів за останні N днів
app.get("/sales/days/:days", async (req, res) => {
  const days = Number(req.params.days);
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const stats = await AnalyticsEvent.aggregate([
    { $match: { eventType: "product.sold", timestamp: { $gte: fromDate } } },
    { $group: { _id: "$productId", totalSold: { $sum: "$quantity" } } }
  ]);

  res.json(stats);
});

// Динаміка продажів по днях
app.get("/sales/dynamics", async (req, res) => {
  const dynamics = await AnalyticsEvent.aggregate([
    { $match: { eventType: "product.sold" } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
        sold: { $sum: "$quantity" }
      }
    },
    { $sort: { "_id": 1 } }
  ]);

  res.json(dynamics);
});

app.listen(3002, () => console.log("Analytics Service running on port 3002"));
