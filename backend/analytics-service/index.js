require('./tracing');
require('./analytics.consumer'); // PostgreSQL connect + RabbitMQ listener

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Op, fn, col, literal } = require('sequelize');
const AnalyticsEvent = require('./analytics.model');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3002;

// ── Auth ─────────────────────────────────────────────────
function verifyToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Токен відсутній' });
    const token = auth.split(' ')[1] || auth;
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.status(403).json({ error: 'Невірний токен' });
    }
}

function parseRange(req) {
    const to   = req.query.to   ? new Date(req.query.to)   : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86400000);
    return { from, to };
}

function toCSV(rows, headers) {
    const escape = v => {
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const head = headers.map(h => escape(h.label || h.key)).join(',');
    const body = rows.map(r => headers.map(h => escape(r[h.key])).join(',')).join('\n');
    return head + '\n' + body;
}

// ── Зведена статистика (group by event_type) ─────────────
app.get('/stats', async (req, res) => {
    try {
        const stats = await AnalyticsEvent.findAll({
            attributes: [
                ['event_type', '_id'],
                [fn('COUNT', '*'), 'count'],
                [fn('SUM', col('quantity')), 'totalQty']
            ],
            group: ['event_type'],
            raw: true
        });
        // Приводимо до старого формату {_id, count, totalQty}
        res.json(stats.map(s => ({
            _id: s._id,
            count: Number(s.count),
            totalQty: Number(s.totalQty) || 0
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Топ продажів за N днів ───────────────────────────────
app.get('/sales/days/:days', async (req, res) => {
    try {
        const days = Number(req.params.days);
        if (isNaN(days) || days < 1) return res.status(400).json({ error: 'Невірна кількість днів' });

        const fromDate = new Date(Date.now() - days * 86400000);
        const stats = await AnalyticsEvent.findAll({
            where: { eventType: 'product.sold', timestamp: { [Op.gte]: fromDate } },
            attributes: [
                ['product_id', '_id'],
                [fn('MIN', col('product_name')), 'name'],
                [fn('SUM', col('quantity')), 'totalSold']
            ],
            group: ['product_id'],
            order: [[literal('"totalSold"'), 'DESC']],
            raw: true
        });
        res.json(stats.map(s => ({
            _id: s._id,
            name: s.name,
            totalSold: Number(s.totalSold) || 0
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Динаміка продажів і списань по днях ──────────────────
app.get('/sales/dynamics', async (req, res) => {
    try {
        const dynamics = await AnalyticsEvent.findAll({
            where: { eventType: { [Op.in]: ['product.sold', 'product.writeoff'] } },
            attributes: [
                [fn('TO_CHAR', col('timestamp'), 'YYYY-MM-DD'), 'date'],
                ['event_type', 'type'],
                [fn('SUM', col('quantity')), 'count']
            ],
            group: [literal(`TO_CHAR("timestamp", 'YYYY-MM-DD')`), 'event_type'],
            order: [[literal('"date"'), 'ASC']],
            raw: true
        });
        // Старий формат: { _id: { date, type }, count }
        res.json(dynamics.map(d => ({
            _id: { date: d.date, type: d.type },
            count: Number(d.count) || 0
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── REQ-5.1: звіт про продажі ────────────────────────────
app.get('/reports/sales', verifyToken, async (req, res) => {
    try {
        const { from, to } = parseRange(req);
        const groupBy = (req.query.groupBy || 'product').toLowerCase();
        const groupCol = {
            product:  { id: 'product_id',  name: 'product_name' },
            category: { id: 'category',    name: 'category' },
            supplier: { id: 'supplier',    name: 'supplier' }
        }[groupBy];
        if (!groupCol) return res.status(400).json({ error: 'groupBy must be product|category|supplier' });

        const rows = await AnalyticsEvent.findAll({
            where: { eventType: 'product.sold', timestamp: { [Op.between]: [from, to] } },
            attributes: [
                [col(groupCol.id), '_id'],
                [fn('MIN', col(groupCol.name)), 'name'],
                [fn('SUM', col('quantity')), 'totalQuantity'],
                [fn('COUNT', '*'), 'events']
            ],
            group: [groupCol.id],
            order: [[literal('"totalQuantity"'), 'DESC']],
            raw: true
        });
        const data = rows.map(r => ({
            _id: r._id,
            name: r.name,
            totalQuantity: Number(r.totalQuantity) || 0,
            events: Number(r.events) || 0
        }));

        if (req.query.format === 'csv') {
            const csv = toCSV(
                data.map(d => ({ name: d.name || '—', totalQuantity: d.totalQuantity, events: d.events })),
                [
                    { key: 'name',          label: 'Найменування' },
                    { key: 'totalQuantity', label: 'Кількість' },
                    { key: 'events',        label: 'Операцій' }
                ]
            );
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="sales_${groupBy}.csv"`);
            return res.send('﻿' + csv);
        }
        res.json({ from, to, groupBy, data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── REQ-5.2: звіт про списання ───────────────────────────
app.get('/reports/writeoff', verifyToken, async (req, res) => {
    try {
        const { from, to } = parseRange(req);
        const rows = await AnalyticsEvent.findAll({
            where: { eventType: 'product.writeoff', timestamp: { [Op.between]: [from, to] } },
            attributes: [
                [fn('COALESCE', col('reason'), 'other'), '_id'],
                [fn('SUM', col('quantity')), 'totalQuantity'],
                [fn('COUNT', '*'), 'events']
            ],
            group: [literal(`COALESCE("reason", 'other')`)],
            order: [[literal('"totalQuantity"'), 'DESC']],
            raw: true
        });

        const REASON_LABELS = {
            expired:  'Прострочення',
            damaged:  'Пошкодження',
            shortage: 'Нестача',
            other:    'Інше',
            '':       'Без причини'
        };
        const enriched = rows.map(d => ({
            reason: d._id,
            label: REASON_LABELS[d._id] || d._id,
            totalQuantity: Number(d.totalQuantity) || 0,
            events: Number(d.events) || 0
        }));

        if (req.query.format === 'csv') {
            const csv = toCSV(enriched, [
                { key: 'label',         label: 'Причина' },
                { key: 'totalQuantity', label: 'Кількість' },
                { key: 'events',        label: 'Операцій' }
            ]);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="writeoff.csv"');
            return res.send('﻿' + csv);
        }
        res.json({ from, to, data: enriched });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── REQ-5.3: динаміка для графіків ───────────────────────
app.get('/reports/dynamics', verifyToken, async (req, res) => {
    try {
        const { from, to } = parseRange(req);
        const rows = await AnalyticsEvent.findAll({
            where: { timestamp: { [Op.between]: [from, to] } },
            attributes: [
                [fn('TO_CHAR', col('timestamp'), 'YYYY-MM-DD'), 'date'],
                ['event_type', 'type'],
                [fn('SUM', col('quantity')), 'count']
            ],
            group: [literal(`TO_CHAR("timestamp", 'YYYY-MM-DD')`), 'event_type'],
            order: [[literal('"date"'), 'ASC']],
            raw: true
        });

        const byDate = {};
        for (const d of rows) {
            const date = d.date;
            if (!byDate[date]) byDate[date] = { date, sold: 0, writeoff: 0, received: 0, expired: 0 };
            const c = Number(d.count) || 0;
            if (d.type === 'product.sold')      byDate[date].sold     = c;
            if (d.type === 'product.writeoff')  byDate[date].writeoff = c;
            if (d.type === 'product.new')       byDate[date].received = c;
            if (d.type === 'product.expired')   byDate[date].expired  = c;
        }
        const series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

        if (req.query.format === 'csv') {
            const csv = toCSV(series, [
                { key: 'date',     label: 'Дата' },
                { key: 'received', label: 'Надходжень' },
                { key: 'sold',     label: 'Продано' },
                { key: 'writeoff', label: 'Списано' },
                { key: 'expired',  label: 'Прострочено' }
            ]);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="dynamics.csv"');
            return res.send('﻿' + csv);
        }
        res.json({ from, to, series });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Останні події ────────────────────────────────────────
app.get('/events/recent', async (req, res) => {
    try {
        const events = await AnalyticsEvent.findAll({
            order: [['timestamp', 'DESC']],
            limit: 20
        });
        res.json(events);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => console.log(`Analytics Service running on port ${PORT}`));
