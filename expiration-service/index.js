require('./tracing');
const express = require('express');
const cors = require('cors');
require('./checker'); // підключаємо MongoDB через checker

const app = express();
app.use(cors());

app.get('/check', async (req, res) => {
    try {
        const { checkExpirations } = require('./checker');
        const result = await checkExpirations();
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3003, () => console.log("Expiration Service running on port 3003"));
