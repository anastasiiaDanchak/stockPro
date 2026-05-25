const { Sequelize } = require('sequelize');

const DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgres://stockpro:stockpro@postgres:5432/authdb';

const sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    define: { freezeTableName: true, timestamps: false }
});

async function connect() {
    while (true) {
        try {
            await sequelize.authenticate();
            console.log('Auth PostgreSQL connected');
            return;
        } catch (err) {
            console.log('Auth PostgreSQL not ready, retrying in 3s...', err.message);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

module.exports = { connect, sequelize };
