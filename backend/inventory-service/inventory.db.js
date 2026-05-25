const { Sequelize } = require('sequelize');

const DATABASE_URL =
    process.env.DATABASE_URL ||
    process.env.INVENTORY_MONGO_URL || // зворотна сумісність зі старим env
    'postgres://stockpro:stockpro@postgres:5432/inventorydb';

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    define: { freezeTableName: true, timestamps: false }
});

async function connect() {
    while (true) {
        try {
            await sequelize.authenticate();
            console.log('Inventory PostgreSQL connected');
            return;
        } catch (err) {
            console.log('Inventory PostgreSQL not ready, retrying in 3s...', err.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

module.exports = { sequelize, connect };
