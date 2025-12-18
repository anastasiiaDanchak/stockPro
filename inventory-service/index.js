require('./tracing');
require('./inventory.db');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { addProduct, getProducts } = require('./inventory.controller');
require('./inventory.consumer');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get('/inventory', async (req, res) => {
    res.json(await getProducts());
});

app.post('/inventory', async (req, res) => {
    const { name, expiry } = req.body;

    if (!name || !expiry) {
        return res.status(400).json({ error: "Заповніть всі поля" });
    }

    try {
        const product = await addProduct({ name, expiry });
        res.json(product);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(3001, () => console.log("Inventory Service running on port 3001"));
