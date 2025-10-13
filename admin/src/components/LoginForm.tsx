import { ChangeEvent, FormEvent, useState } from 'react'
import { useAdminStore } from '../store/adminStore'

type StoreState = ReturnType<typeof useAdminStore.getState>

export const LoginForm = () => {
  const { login, status, error, clearError } = useAdminStore((state: StoreState) => ({
    login: state.login,
    status: state.status,
    error: state.error,
    clearError: state.clearError,
  }))

  const [loginField, setLoginField] = useState('')
  const [passwordField, setPasswordField] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!loginField || !passwordField) return
    await login(loginField, passwordField)
  }

  return (
    <form className="glass-card" onSubmit={handleSubmit} onFocus={() => clearError()}>
      <h1>Админ-панель</h1>
      <p className="auth-meta">Введите логин администратора, судьи или помощника/капитана.</p>
      {error ? <div className="error-banner">Ошибка авторизации: {error}</div> : null}
      <div className="form-field">
        <label htmlFor="admin-login">Логин</label>
        <input
          id="admin-login"
          name="login"
          autoComplete="username"
          value={loginField}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setLoginField(event.target.value)}
          required
        />
      </div>
      <div className="form-field">
        <label htmlFor="admin-password">Пароль</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={passwordField}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setPasswordField(event.target.value)}
          required
        />
      </div>
      <button className="button-primary" type="submit" disabled={status === 'authenticating'}>
        {status === 'authenticating' ? 'Проверяем…' : 'Войти'}
      </button>
      <p className="auth-meta">
        Админ: LOGIN_ADMIN / PASSWORD_ADMIN · Судья: SUDIA_LOGIN / SUDIA_PASSWORD · Помощник матча:
        POMOSH_LOGIN / POMOSH_PASSWORD · Капитан: LINEUP_PORTAL_LOGIN / LINEUP_PORTAL_PASSWORD.
      </p>
    </form>
  )
}
