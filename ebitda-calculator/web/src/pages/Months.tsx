import { useState } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useYear } from '../hooks/useYear'
import {
  formatMoney,
  formatInputValue,
  formatNumber,
  parseMoney,
  updateMonthEbitda,
  toggleMonthLock,
  MONTH_NAMES,
} from '../lib/supabase'

export default function Months() {
  const { currentWorkspace, isAdmin } = useWorkspace()
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const {
    months,
    yearData,
    loading,
    error,
    initialized,
    initializeYear,
    recalculate,
    refresh,
  } = useYear(selectedYear)

  // Модальное окно редактирования EBITDA
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingMonth, setEditingMonth] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editComment, setEditComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const handleOpenEditModal = (month: number, currentValue: number | null) => {
    if (!isAdmin) return
    setEditingMonth(month)
    setEditValue(currentValue !== null ? formatNumber(currentValue) : '')
    setEditComment('')
    setEditError(null)
    setShowEditModal(true)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!currentWorkspace || editingMonth === null) return

    setSaving(true)
    setEditError(null)

    const value = parseMoney(editValue)
    if (editValue && value === null) {
      setEditError('Введите корректное число')
      setSaving(false)
      return
    }

    const result = await updateMonthEbitda(
      currentWorkspace.id,
      selectedYear,
      editingMonth,
      value,
      editComment || undefined
    )

    if (!result.success) {
      setEditError(result.error?.message || 'Ошибка сохранения')
    } else {
      setShowEditModal(false)
      setEditingMonth(null)
      setEditValue('')
      setEditComment('')
      await refresh()
    }

    setSaving(false)
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingMonth(null)
    setEditValue('')
    setEditComment('')
    setEditError(null)
  }

  const handleToggleLock = async (month: number, currentLocked: boolean) => {
    if (!currentWorkspace || !isAdmin) return

    setSaving(true)
    setActionError(null)

    const result = await toggleMonthLock(currentWorkspace.id, selectedYear, month, !currentLocked)

    if (!result.success) {
      setActionError(result.error?.message || 'Ошибка')
    } else {
      await refresh()
    }

    setSaving(false)
  }

  const handleRecalculate = async () => {
    setSaving(true)
    setActionError(null)

    const result = await recalculate()

    if (result.error) {
      setActionError(result.error)
    }

    setSaving(false)
  }

  const handleInitYear = async () => {
    setSaving(true)
    setActionError(null)

    const result = await initializeYear()

    if (result.error) {
      setActionError(result.error)
    }

    setSaving(false)
  }

  // Итоги
  const totals = months.reduce(
    (acc, m) => ({
      ebitda: acc.ebitda + (m.ebitda || 0),
      retention: acc.retention + m.retention,
      growth_bonus: acc.growth_bonus + m.growth_bonus,
      total_bonus: acc.total_bonus + m.total_bonus,
      paid_now: acc.paid_now + m.paid_now,
      to_bank: acc.to_bank + m.to_bank,
    }),
    { ebitda: 0, retention: 0, growth_bonus: 0, total_bonus: 0, paid_now: 0, to_bank: 0 }
  )

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Месячные расчёты</h1>
          <p className="page-subtitle">{currentWorkspace?.name}</p>
        </div>
        <div className="flex gap-md">
          <select
            className="select"
            style={{ width: 'auto' }}
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <option key={y} value={y}>
                {y} год
              </option>
            ))}
          </select>
          {initialized && isAdmin && (
            <button className="btn btn-secondary" onClick={handleRecalculate} disabled={saving}>
              Пересчитать
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {actionError && (
        <div className="alert alert-error">
          {actionError}
          {actionError === 'Месяц не найден' && (
            <>
              {' — '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  handleInitYear()
                }}
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                Инициализировать {selectedYear} год
              </a>
            </>
          )}
        </div>
      )}

      {yearData?.closed && (
        <div className="alert alert-warning mb-lg">
          Год закрыт. Редактирование запрещено.
        </div>
      )}

      {!initialized ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Год {selectedYear} не инициализирован</h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
            Создайте структуру года для начала работы
          </p>
          <button className="btn btn-primary btn-lg" onClick={handleInitYear} disabled={saving}>
            {saving ? 'Создание...' : `Инициализировать ${selectedYear} год`}
          </button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Месяц</th>
                <th className="text-right">EBITDA</th>
                <th className="text-right">База</th>
                <th className="text-right">Удержание</th>
                <th className="text-right">Рост</th>
                <th className="text-right">Бонус</th>
                <th className="text-right">Сейчас</th>
                <th className="text-right">В банк</th>
                <th style={{ width: '50px' }}></th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className={m.locked ? 'locked' : ''}>
                  <td>
                    <strong>{MONTH_NAMES[m.month - 1]}</strong>
                  </td>
                  <td className={`numeric ${m.ebitda === null ? 'empty' : ''}`}>
                    <span
                      onClick={() => !m.locked && !yearData?.closed && isAdmin && handleOpenEditModal(m.month, m.ebitda)}
                      style={{
                        cursor: m.locked || yearData?.closed || !isAdmin ? 'default' : 'pointer',
                        padding: 'var(--spacing-xs) var(--spacing-sm)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                      className={!m.locked && !yearData?.closed && isAdmin ? 'input-inline' : ''}
                    >
                      {m.ebitda !== null ? formatMoney(m.ebitda) : '—'}
                    </span>
                  </td>
                  <td className="numeric text-muted">{formatMoney(m.monthly_base)}</td>
                  <td className="numeric">{formatMoney(m.retention)}</td>
                  <td className="numeric">{formatMoney(m.growth_bonus)}</td>
                  <td className="numeric">
                    <strong>{formatMoney(m.total_bonus)}</strong>
                  </td>
                  <td className="numeric">{formatMoney(m.paid_now)}</td>
                  <td className="numeric">{formatMoney(m.to_bank)}</td>
                  <td className="text-center">
                    {isAdmin && !yearData?.closed && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleToggleLock(m.month, m.locked)}
                        title={m.locked ? 'Разблокировать' : 'Заблокировать'}
                        disabled={saving}
                      >
                        {m.locked ? '🔒' : '🔓'}
                      </button>
                    )}
                    {yearData?.closed && '🔒'}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td>
                  <strong>Итого</strong>
                </td>
                <td className="numeric">
                  <strong>{formatMoney(totals.ebitda)}</strong>
                </td>
                <td></td>
                <td className="numeric">{formatMoney(totals.retention)}</td>
                <td className="numeric">{formatMoney(totals.growth_bonus)}</td>
                <td className="numeric">
                  <strong>{formatMoney(totals.total_bonus)}</strong>
                </td>
                <td className="numeric">{formatMoney(totals.paid_now)}</td>
                <td className="numeric">{formatMoney(totals.to_bank)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Модальное окно редактирования EBITDA */}
      {showEditModal && editingMonth !== null && (
        <div className="modal-overlay" onClick={handleCloseEditModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {MONTH_NAMES[editingMonth - 1]} {selectedYear}
              </h2>
            </div>
            <form onSubmit={handleSaveEdit}>
              <div className="modal-body">
                {editError && <div className="alert alert-error">{editError}</div>}
                <div className="form-group">
                  <label className="form-label">EBITDA (₽)</label>
                  <input
                    type="text"
                    className="input"
                    value={editValue}
                    onChange={(e) => setEditValue(formatInputValue(e.target.value))}
                    placeholder="1 000 000"
                    autoFocus
                  />
                </div>
                <div className="form-group mb-0">
                  <label className="form-label">Комментарий (опционально)</label>
                  <input
                    type="text"
                    className="input"
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    placeholder="Примечание к изменению"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseEditModal}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
