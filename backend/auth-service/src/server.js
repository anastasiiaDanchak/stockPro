const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connect } = require('./db');
const authRoutes = require('./routes/auth.routes');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Gateway знімає /auth префікс → сервіс отримує /login
app.use('/', authRoutes);

const PORT = process.env.PORT || 4001;

(async () => {
    await connect();
    if (typeof authRoutes.seedIfEmpty === 'function') {
        try { await authRoutes.seedIfEmpty(); } catch (e) {
            console.error('Seed failed:', e.message);
        }
    }
    app.listen(PORT, () => console.log(`Auth Service running on port ${PORT}`));
})();
