import { useState, useContext } from 'react';
import { AuthContext } from '../auth/AuthContext';
import { registerUser } from '../api/api';

// REQ-1.1: реєстрація користувачів
// Доступ: лише admin (керується ProtectedRoute)
export default function Register({ standalone = false }) {
    const { user } = useContext(AuthContext);
    const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'cashier' });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError]     = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);
    const [pwdTouched, setPwdTouched] = useState(false);

    // REQ-1.4: вимоги до пароля — синхронізовано з бекендом
    //   ≥ 8 символів, хоча б одна літера і хоча б одна цифра.
    const pwdChecks = {
        length:  form.password.length >= 8,
        letter:  /[A-Za-zА-ЯҐЄІЇа-яґєії]/.test(form.password),
        digit:   /\d/.test(form.password)
    };
    const pwdValid = pwdChecks.length && pwdChecks.letter && pwdChecks.digit;

    const validatePassword = (pwd) => {
        if (pwd.length < 8)                              return 'Пароль повинен містити щонайменше 8 символів';
        if (!/[A-Za-zА-ЯҐЄІЇа-яґєії]/.test(pwd))       return 'Пароль має містити хоча б одну літеру';
        if (!/\d/.test(pwd))                             return 'Пароль має містити хоча б одну цифру';
        return null;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(''); setSuccess(''); setLoading(true);
        try {
            if (!form.fullName.trim()) {
                setError('Введіть імʼя користувача'); setLoading(false); return;
            }
            const pwErr = validatePassword(form.password);
            if (pwErr) { setError(pwErr); setLoading(false); return; }

            const result = await registerUser(form, user?.token);
            setSuccess(`✓ Користувача "${result.fullName || result.email}" створено з роллю "${result.role}"`);
            setForm({ fullName: '', email: '', password: '', role: 'cashier' });
            setPwdTouched(false);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const Wrapper = 'div';

    return (
        <Wrapper className={standalone ? 'login-page' : 'page'}>
            <div className={standalone ? 'login-card' : 'section-card section-card--form'}>
                {standalone && (
                    <div className="login-header">
                        <div className="login-logo">S</div>
                        <h1 className="login-title">Реєстрація</h1>
                        <p className="login-subtitle">Створіть нового користувача</p>
                    </div>
                )}
                {!standalone && (
                    <h2 className="section-card-title" style={{ marginBottom: '1rem' }}>
                        Реєстрація нового користувача
                    </h2>
                )}

                <form className={standalone ? 'login-form' : 'inline-form'} onSubmit={handleSubmit}>
                    {/* Імʼя */}
                    <div className="form-group" style={!standalone ? { gridColumn: '1/-1' } : undefined}>
                        <label className="form-label">Імʼя та прізвище *</label>
                        <input
                            className="form-input"
                            type="text"
                            value={form.fullName}
                            onChange={e => setForm({ ...form, fullName: e.target.value })}
                            placeholder="Ольга Петренко"
                            autoComplete="name"
                            required
                        />
                    </div>

                    {/* Email */}
                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            className="form-input"
                            type="email"
                            value={form.email}
                            onChange={e => setForm({ ...form, email: e.target.value })}
                            placeholder="user@company.com"
                            autoComplete="off"
                            required
                        />
                    </div>

                    {/* Пароль */}
                    <div className="form-group">
                        <label className="form-label">Пароль</label>
                        <div className="input-with-toggle">
                            <input
                                className={`form-input${pwdTouched && !pwdValid ? ' form-input--error' : ''}`}
                                type={showPassword ? 'text' : 'password'}
                                value={form.password}
                                onChange={e => { setForm({ ...form, password: e.target.value }); setPwdTouched(true); }}
                                onBlur={() => setPwdTouched(true)}
                                placeholder="Мінімум 8 символів"
                                autoComplete="new-password"
                                minLength={8}
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
                        {/* Живі індикатори вимог */}
                        {(pwdTouched || form.password.length > 0) && (
                            <div className="pwd-requirements">
                                <span className={pwdChecks.length ? 'pwd-req pwd-req--ok' : 'pwd-req'}>
                                    {pwdChecks.length ? '✓' : '○'} Не менше 8 символів
                                </span>
                                <span className={pwdChecks.letter ? 'pwd-req pwd-req--ok' : 'pwd-req'}>
                                    {pwdChecks.letter ? '✓' : '○'} Хоча б одна літера
                                </span>
                                <span className={pwdChecks.digit ? 'pwd-req pwd-req--ok' : 'pwd-req'}>
                                    {pwdChecks.digit ? '✓' : '○'} Хоча б одна цифра
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Роль */}
                    <div className="form-group">
                        <label className="form-label">Роль</label>
                        <select
                            className="form-input"
                            value={form.role}
                            onChange={e => setForm({ ...form, role: e.target.value })}
                        >
                            {/* Адміністратор НЕ створюється через UI — лише касир/аналітик */}
                            <option value="cashier">Касир</option>
                            <option value="analyst">Аналітик</option>
                        </select>
                        <span className="field-hint">
                            Адміністраторський акаунт можна створити лише напряму в БД
                        </span>
                    </div>

                    {error   && <div className="alert alert--danger"  style={{ gridColumn: '1/-1' }}>⚠ {error}</div>}
                    {success && <div className="alert alert--success" style={{ gridColumn: '1/-1' }}>{success}</div>}

                    <div className="form-actions">
                        <button className="btn btn--primary" type="submit" disabled={loading}>
                            {loading ? '⏳ Збереження...' : '+ Зареєструвати'}
                        </button>
                    </div>
                </form>
            </div>
        </Wrapper>
    );
}
