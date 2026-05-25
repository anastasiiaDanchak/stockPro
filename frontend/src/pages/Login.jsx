import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../auth/AuthContext';
import { login } from '../api/api';

export default function Login() {
    const [email, setEmail]           = useState('');
    const [password, setPassword]     = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError]           = useState('');
    const [loading, setLoading]       = useState(false);
    const [emailTouched, setEmailTouched] = useState(false);

    const { loginUser } = useContext(AuthContext);
    const navigate = useNavigate();

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            // login() тепер кидає Error при 4xx/5xx — обробляємо у catch
            const data = await login(email, password);
            loginUser({
                token:    data.token,
                role:     data.role,
                email:    data.email || email,
                fullName: data.fullName || '',
                id:       data.id
            });
            // Редірект на першу робочу вкладку залежно від ролі
            const homeByRole = {
                admin:   '/admin/supply',
                cashier: '/cashier/sales',
                analyst: '/analyst/dashboard'
            };
            navigate(homeByRole[data.role] || '/');
        } catch (err) {
            // Розрізняємо помилки авторизації від мережевих
            if (err.status === 401 || err.status === 400) {
                setError('Невірний email або пароль');
            } else if (err.status >= 500) {
                setError('Помилка сервера. Спробуйте пізніше.');
            } else {
                setError(err.message || 'Помилка входу. Перевірте з\'єднання.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">S</div>
                    <h1 className="login-title">StockPro</h1>
                    <p className="login-subtitle">Система обліку товарів</p>
                </div>

                <form className="login-form" onSubmit={handleLogin}>
                    {/* Email */}
                    <div className="form-group">
                        <label className="form-label" htmlFor="login-email">Email</label>
                        <input
                            id="login-email"
                            className={`form-input${emailTouched && !emailValid ? ' form-input--error' : ''}`}
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            onBlur={() => setEmailTouched(true)}
                            placeholder="user@example.com"
                            autoComplete="email"
                            required
                            autoFocus
                        />
                        {emailTouched && !emailValid && email.length > 0 && (
                            <span className="field-hint field-hint--error">
                                Введіть коректну адресу, наприклад: name@company.com
                            </span>
                        )}
                    </div>

                    {/* Пароль */}
                    <div className="form-group">
                        <label className="form-label" htmlFor="login-password">Пароль</label>
                        <div className="input-with-toggle">
                            <input
                                id="login-password"
                                className="form-input"
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Введіть ваш пароль"
                                autoComplete="current-password"
                                required
                            />
                            <button
                                type="button"
                                className="toggle-password"
                                onClick={() => setShowPassword(v => !v)}
                                title={showPassword ? 'Приховати пароль' : 'Показати пароль'}
                                tabIndex={-1}
                            >
                                {showPassword ? '🙈' : '👁'}
                            </button>
                        </div>
                        <span className="field-hint">
                            Пароль чутливий до регістру
                        </span>
                    </div>

                    {error && (
                        <div className="alert alert--danger">
                            ⚠ {error}
                        </div>
                    )}

                    <button
                        className="btn btn--primary btn--full"
                        type="submit"
                        disabled={loading || !email || !password}
                    >
                        {loading ? '⏳ Вхід...' : 'Увійти'}
                    </button>
                </form>

                <div className="login-register-hint">
                    Новий обліковий запис створює адміністратор у Налаштуваннях.
                </div>
            </div>
        </div>
    );
}
