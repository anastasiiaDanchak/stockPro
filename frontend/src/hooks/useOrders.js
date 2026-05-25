import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'stockpro_supply_orders';

/** @typedef {{ name: string, expiry: string, quantity: number }} OrderItem */
/** @typedef {{ id: string, supplier: string, note: string, items: OrderItem[],
 *               status: 'pending'|'received'|'cancelled',
 *               createdAt: string, receivedAt?: string }} SupplyOrder */

const readStorage = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

const writeStorage = (orders) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
};

export default function useOrders() {
    const [orders, setOrders] = useState([]);

    useEffect(() => {
        setOrders(readStorage());
    }, []);

    const persist = useCallback((next) => {
        writeStorage(next);
        setOrders(next);
    }, []);

    const addOrder = useCallback((order) => {
        const newOrder = {
            id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            status: 'pending',
            createdAt: new Date().toISOString(),
            ...order
        };
        const next = [newOrder, ...readStorage()];
        persist(next);
        return newOrder;
    }, [persist]);

    const updateOrder = useCallback((id, patch) => {
        const next = readStorage().map(o => (o.id === id ? { ...o, ...patch } : o));
        persist(next);
    }, [persist]);

    const removeOrder = useCallback((id) => {
        const next = readStorage().filter(o => o.id !== id);
        persist(next);
    }, [persist]);

    return { orders, addOrder, updateOrder, removeOrder };
}
