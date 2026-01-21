import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useState } from 'react'
import { updateMonthEbitda, initYear, MONTH_NAMES, formatInputValue } from '../lib/supabase'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { signOut } = useAuth()
  const { currentWorkspace, workspaces, setCurrentWorkspace, createWorkspace, loading } = useWorkspace()
  const navigate = useNavigate()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Кнопка "Создать" и форма начисления
  const [showCreateDropdown, setShowCreateDropdown] = useState(false)
  const [showEbitdaModal, setShowEbitdaModal] = useState(false)
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1
  const [ebitdaYear, setEbitdaYear] = useState(currentYear)
  const [ebitdaMonth, setEbitdaMonth] = useState(currentMonth)
  const [ebitdaValue, setEbitdaValue] = useState('')
  const [ebitdaComment, setEbitdaComment] = useState('')
  const [ebitdaSaving, setEbitdaSaving] = useState(false)
  const [ebitdaError, setEbitdaError] = useState<string | null>(null)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const handleSaveEbitda = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentWorkspace) return

    setEbitdaSaving(true)
    setEbitdaError(null)

    // Сначала пробуем инициализировать год (если ещё не инициализирован)
    await initYear(currentWorkspace.id, ebitdaYear)

    // Теперь сохраняем EBITDA
    const value = parseInt(ebitdaValue.replace(/\s/g, ''), 10)
    if (isNaN(value)) {
      setEbitdaError('Введите корректное число')
      setEbitdaSaving(false)
      return
    }

    const result = await updateMonthEbitda(
      currentWorkspace.id,
      ebitdaYear,
      ebitdaMonth,
      value,
      ebitdaComment || undefined
    )

    if (!result.success) {
      setEbitdaError(result.error?.message || 'Ошибка сохранения')
    } else {
      setShowEbitdaModal(false)
      setEbitdaValue('')
      setEbitdaComment('')
      setShowCreateDropdown(false)
      // Переходим на страницу месячных расчётов
      navigate('/months')
      window.location.reload()
    }

    setEbitdaSaving(false)
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWorkspaceName.trim()) return

    setCreating(true)
    setError(null)

    const result = await createWorkspace(newWorkspaceName.trim())

    if (result.error) {
      setError(result.error)
    } else {
      setShowCreateModal(false)
      setNewWorkspaceName('')
    }

    setCreating(false)
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    )
  }

  // Если нет workspace — показываем форму создания
  if (!currentWorkspace) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1 className="auth-title">Создание организации</h1>
          <p style={{ textAlign: 'center', marginBottom: 'var(--spacing-lg)', color: 'var(--color-text-secondary)' }}>
            Для начала работы создайте организацию
          </p>
          <form className="auth-form" onSubmit={handleCreateWorkspace}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Название организации</label>
              <input
                type="text"
                className="input"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                placeholder="ООО «Компания»"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={creating}>
              {creating ? 'Создание...' : 'Создать организацию'}
            </button>
          </form>
          <div className="auth-footer">
            <button onClick={handleSignOut} className="btn btn-ghost">
              Выйти
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        {/* Логотип слева */}
        <div className="app-logo">
          📊 EBITDA Мотивация
        </div>

        {/* Правая часть: кнопка Создать, название организации, Выйти */}
        <div className="app-header-actions">
          {/* Кнопка "Создать" с выпадающим меню */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateDropdown(!showCreateDropdown)}
            >
              + Создать
            </button>
            {showCreateDropdown && (
              <>
                <div
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 99,
                  }}
                  onClick={() => setShowCreateDropdown(false)}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 'var(--spacing-xs)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    zIndex: 100,
                    minWidth: '200px',
                  }}
                >
                  <button
                    className="btn btn-ghost"
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      borderRadius: 0,
                      padding: 'var(--spacing-sm) var(--spacing-md)',
                    }}
                    onClick={() => {
                      setShowEbitdaModal(true)
                      setShowCreateDropdown(false)
                    }}
                  >
                    📊 Начисление EBITDA
                  </button>
                </div>
              </>
            )}
          </div>

          {workspaces.length > 1 && (
            <select
              className="select"
              style={{ width: 'auto', minWidth: '200px' }}
              value={currentWorkspace.id}
              onChange={(e) => {
                const ws = workspaces.find((w) => w.id === e.target.value)
                if (ws) setCurrentWorkspace(ws)
              }}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          )}
          {workspaces.length === 1 && (
            <span style={{ color: 'var(--color-text-secondary)' }}>{currentWorkspace.name}</span>
          )}
          <button onClick={handleSignOut} className="btn btn-ghost">
            Выйти
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <NavLink to="/" end className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
          Сводка
        </NavLink>
        <NavLink to="/months" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
          Месячные расчёты
        </NavLink>
        <NavLink to="/bank" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
          Банк и выплаты
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `app-nav-link ${isActive ? 'active' : ''}`}>
          Настройки
        </NavLink>
      </nav>

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>

      {/* Модал создания EBITDA начисления */}
      {showEbitdaModal && (
        <div className="modal-overlay" onClick={() => setShowEbitdaModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Начисление EBITDA</h2>
            </div>
            <form onSubmit={handleSaveEbitda}>
              <div className="modal-body">
                {ebitdaError && <div className="alert alert-error">{ebitdaError}</div>}
                <div className="form-group">
                  <label className="form-label">Год</label>
                  <select
                    className="select"
                    value={ebitdaYear}
                    onChange={(e) => setEbitdaYear(Number(e.target.value))}
                  >
                    {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Месяц</label>
                  <select
                    className="select"
                    value={ebitdaMonth}
                    onChange={(e) => setEbitdaMonth(Number(e.target.value))}
                  >
                    {MONTH_NAMES.map((name, idx) => (
                      <option key={idx + 1} value={idx + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">EBITDA (₽)</label>
                  <input
                    type="text"
                    className="input"
                    value={ebitdaValue}
                    onChange={(e) => setEbitdaValue(formatInputValue(e.target.value))}
                    placeholder="1 000 000"
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group mb-0">
                  <label className="form-label">Комментарий (опционально)</label>
                  <input
                    type="text"
                    className="input"
                    value={ebitdaComment}
                    onChange={(e) => setEbitdaComment(e.target.value)}
                    placeholder="Примечание к начислению"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEbitdaModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={ebitdaSaving}>
                  {ebitdaSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модал создания workspace */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Новая организация</h2>
            </div>
            <form onSubmit={handleCreateWorkspace}>
              <div className="modal-body">
                {error && <div className="alert alert-error">{error}</div>}
                <div className="form-group mb-0">
                  <label className="form-label">Название</label>
                  <input
                    type="text"
                    className="input"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    placeholder="ООО «Компания»"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Создание...' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
