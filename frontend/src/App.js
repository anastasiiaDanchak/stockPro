import './App.css';
import { useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, AuthContext } from './auth/AuthContext';
import Navbar        from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/Login';

// ── Адміністратор ──────────────────────────────────────
import SupplyOrders    from './pages/admin/SupplyOrders';
import Invoices        from './pages/admin/Invoices';
import StockByCategory from './pages/admin/StockByCategory';
import Nomenclature    from './pages/admin/Nomenclature';
import AdminSettings   from './pages/admin/AdminSettings';

// ── Касир ──────────────────────────────────────────────
import Sales              from './pages/cashier/Sales';
import WriteOffs          from './pages/cashier/WriteOffs';
import CashierStock       from './pages/cashier/CashierStock';
import CashierExpirations from './pages/cashier/CashierExpirations';

// ── Аналітик ───────────────────────────────────────────
import AnalystDashboard  from './pages/analyst/AnalystDashboard';
import SalesReport       from './pages/analyst/SalesReport';
import WriteoffReport    from './pages/analyst/WriteoffReport';
import TopSales          from './pages/analyst/TopSales';

// ── Спільне ────────────────────────────────────────────
import OperationsHistory from './pages/OperationsHistory';

// Кожна роль одразу потрапляє на свою першу вкладку — без «Головної».
function RoleHome() {
    const { user } = useContext(AuthContext);
    if (!user) return <Navigate to="/login" replace />;
    if (user.role === 'admin')   return <Navigate to="/admin/supply"          replace />;
    if (user.role === 'cashier') return <Navigate to="/cashier/sales"         replace />;
    if (user.role === 'analyst') return <Navigate to="/analyst/dashboard"     replace />;
    return <Navigate to="/login" replace />;
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login"    element={<Login />} />
                    {/* Публічна реєстрація вимкнена — користувачів додає адмін у Налаштуваннях */}
                    <Route path="/register" element={<Navigate to="/login" replace />} />

                    <Route
                        path="/*"
                        element={
                            <ProtectedRoute>
                                <div className="app-layout">
                                    <Navbar />
                                    <main className="app-main">
                                        <Routes>
                                            <Route path="/" element={<RoleHome />} />

                                            {/* Журнал операцій — адмін бачить усі, касир — свої */}
                                            <Route
                                                path="/operations"
                                                element={
                                                    <ProtectedRoute roles={['admin', 'cashier']}>
                                                        <OperationsHistory />
                                                    </ProtectedRoute>
                                                }
                                            />

                                            {/* ── Адмін ── */}
                                            <Route path="/admin/supply"       element={<ProtectedRoute roles={['admin']}><SupplyOrders /></ProtectedRoute>} />
                                            <Route path="/admin/invoices"     element={<ProtectedRoute roles={['admin']}><Invoices /></ProtectedRoute>} />
                                            <Route path="/admin/stock"        element={<ProtectedRoute roles={['admin']}><StockByCategory /></ProtectedRoute>} />
                                            <Route path="/admin/nomenclature" element={<ProtectedRoute roles={['admin']}><Nomenclature /></ProtectedRoute>} />
                                            <Route path="/admin/settings"     element={<ProtectedRoute roles={['admin']}><AdminSettings /></ProtectedRoute>} />

                                            {/* ── Касир ── */}
                                            <Route path="/cashier/sales"       element={<ProtectedRoute roles={['cashier']}><Sales /></ProtectedRoute>} />
                                            <Route path="/cashier/writeoffs"   element={<ProtectedRoute roles={['cashier']}><WriteOffs /></ProtectedRoute>} />
                                            <Route path="/cashier/stock"       element={<ProtectedRoute roles={['cashier']}><CashierStock /></ProtectedRoute>} />
                                            <Route path="/cashier/expirations" element={<ProtectedRoute roles={['cashier']}><CashierExpirations /></ProtectedRoute>} />

                                            {/* ── Аналітик ── */}
                                            <Route path="/analyst/dashboard"       element={<ProtectedRoute roles={['analyst']}><AnalystDashboard /></ProtectedRoute>} />
                                            <Route path="/analyst/sales-report"    element={<ProtectedRoute roles={['analyst']}><SalesReport /></ProtectedRoute>} />
                                            <Route path="/analyst/writeoff-report" element={<ProtectedRoute roles={['analyst']}><WriteoffReport /></ProtectedRoute>} />
                                            <Route path="/analyst/top-sales"       element={<ProtectedRoute roles={['analyst']}><TopSales /></ProtectedRoute>} />

                                            {/* Fallback — редірект на домашню сторінку ролі */}
                                            <Route path="*" element={<RoleHome />} />
                                        </Routes>
                                    </main>
                                </div>
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}
