import { createContext, useState, useEffect, useCallback } from "react";
import { setUnauthorizedHandler } from "../api/api";

export const AuthContext = createContext();

// Розшифровуємо payload JWT (без перевірки підпису — лише на фронтенді)
function parseJwtPayload(token) {
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
    } catch {
        return null;
    }
}

// Перевіряємо, чи токен ще не прострочений
function isTokenValid(token) {
    if (!token) return false;
    const payload = parseJwtPayload(token);
    if (!payload || !payload.exp) return false;
    // Даємо 30-секундний запас на синхронізацію часу
    return payload.exp * 1000 > Date.now() + 30_000;
}

// Повертає скільки мс залишилось до закінчення токена (або 0)
function msUntilExpiry(token) {
    const payload = parseJwtPayload(token);
    if (!payload || !payload.exp) return 0;
    return Math.max(0, payload.exp * 1000 - Date.now() - 30_000);
}

export const AuthProvider = ({ children }) => {
    // Читаємо localStorage СИНХРОННО до першого рендеру —
    // так ProtectedRoute одразу бачить user, а не null
    const [user, setUser] = useState(() => {
        try {
            const saved = localStorage.getItem("stockpro_user");
            if (!saved) return null;
            const parsed = JSON.parse(saved);
            // Відразу перевіряємо чи токен ще дійсний
            if (!isTokenValid(parsed?.token)) {
                localStorage.removeItem("stockpro_user");
                return null;
            }
            return parsed;
        } catch {
            localStorage.removeItem("stockpro_user");
            return null;
        }
    });

    // Авто-логаут при закінченні токена
    const logout = useCallback(() => {
        setUser(null);
        localStorage.removeItem("stockpro_user");
    }, []);

    // Планує авто-логаут рівно коли токен проcтрочиться
    useEffect(() => {
        if (!user?.token) return;
        const ms = msUntilExpiry(user.token);
        if (ms <= 0) { logout(); return; }
        const timer = setTimeout(logout, ms);
        return () => clearTimeout(timer);
    }, [user?.token, logout]);

    // Реєструємо callback для авто-логауту при HTTP 401
    useEffect(() => {
        setUnauthorizedHandler(logout);
        return () => setUnauthorizedHandler(null);
    }, [logout]);

    const loginUser = useCallback((data) => {
        setUser(data);
        localStorage.setItem("stockpro_user", JSON.stringify(data));
    }, []);

    return (
        <AuthContext.Provider value={{ user, loginUser, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
