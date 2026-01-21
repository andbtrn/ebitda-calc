import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    try {
      if (isRegister) {
        const { error } = await signUp(email, password)
        if (error) {
          setError(error.message)
        } else {
          setMessage('Проверьте почту для подтверждения регистрации')
        }
      } else {
        const { error } = await signIn(email, password)
        if (error) {
          setError(error.message === 'Invalid login credentials'
            ? 'Неверный email или пароль'
            : error.message)
        } else {
          navigate('/')
        }
      }
    } catch (err) {
      setError('Произошла ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">
          {isRegister ? 'Регистрация' : 'Вход'}
        </h1>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
            {isRegister && (
              <p className="form-hint">Минимум 6 символов</p>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Загрузка...' : isRegister ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>

        <div className="auth-footer">
          {isRegister ? (
            <>
              Уже есть аккаунт?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(false); setError(null); setMessage(null); }}>
                Войти
              </a>
            </>
          ) : (
            <>
              Нет аккаунта?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(true); setError(null); setMessage(null); }}>
                Зарегистрироваться
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
