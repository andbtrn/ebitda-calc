import { useState } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useYear } from '../hooks/useYear'
import {
  formatMoney,
  formatInputValue,
  executeQuarterPayout,
  executeYearPayout,
  adjustBank,
  parseMoney,
} from '../lib/supabase'

export default function Bank() {
  const { currentWorkspace, isAdmin } = useWorkspace()
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const {
    quarters,
    yearData,
    ledger,
    bankBalance,
    loading,
    error,
    initialized,
    initializeYear,
    refresh,
  } = useYear(selectedYear)

  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  // Модал подтверждения
  const [confirmModal, setConfirmModal] = useState<{
    type: 'quarter' | 'year' | 'adjust' | null
    quarter?: number
    amount?: number
  }>({ type: null })

  // Форма корректировки
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustComment, setAdjustComment] = useState('')
  const [showAdjustForm, setShowAdjustForm] = useState(false)

  const handleQuarterPayout = async (quarter: number) => {
    if (!currentWorkspace) return

    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)

    const result = await executeQuarterPayout(currentWorkspace.id, selectedYear, quarter)

    if (!result.success) {
      setActionError(result.error?.message || 'Ошибка выплаты')
    } else {
      setActionSuccess(`Выплата за Q${quarter} выполнена: ${formatMoney(result.data?.amount)}`)
      await refresh()
    }

    setConfirmModal({ type: null })
    setActionLoading(false)
  }

  const handleYearPayout = async () => {
    if (!currentWorkspace) return

    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)

    const result = await executeYearPayout(currentWorkspace.id, selectedYear)

    if (!result.success) {
      setActionError(result.error?.message || 'Ошибка')
    } else {
      setActionSuccess(result.data?.message || 'Год закрыт')
      await refresh()
    }

    setConfirmModal({ type: null })
    setActionLoading(false)
  }

  const handleAdjust = async () => {
    if (!currentWorkspace) return

    const amount = parseMoney(adjustAmount)
    if (amount === null) {
      setActionError('Введите корректную сумму')
      return
    }

    if (!adjustComment.trim()) {
      setActionError('Комментарий обязателен')
      return
    }

    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)

    const result = await adjustBank(currentWorkspace.id, selectedYear, amount, adjustComment.trim())

    if (!result.success) {
      setActionError(result.error?.message || 'Ошибка')
    } else {
      setActionSuccess(`Корректировка выполнена: ${formatMoney(amount)}`)
      setAdjustAmount('')
      setAdjustComment('')
      setShowAdjustForm(false)
      await refresh()
    }

    setConfirmModal({ type: null })
    setActionLoading(false)
  }

  const handleInitYear = async () => {
    setActionLoading(true)
    const result = await initializeYear()
    if (result.error) {
      setActionError(result.error)
    }
    setActionLoading(false)
  }

  const getOperationLabel = (type: string, quarter?: number | null) => {
    switch (type) {
      case 'year_start':
        return 'Начало года'
      case 'month_accrual':
        return 'Начисление'
      case 'quarter_payout':
        return `Квартальная выплата Q${quarter}`
      case 'year_payout':
        return 'Годовая выплата'
      case 'manual_adjustment':
        return 'Ручная корректировка'
      case 'recalc_adjustment':
        return 'Корректировка (перерасчёт)'
      default:
        return type
    }
  }

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
          <h1 className="page-title">Банк и выплаты</h1>
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
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {actionError && <div className="alert alert-error">{actionError}</div>}
      {actionSuccess && <div className="alert alert-success">{actionSuccess}</div>}

      {!initialized ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Год {selectedYear} не инициализирован</h2>
          <button className="btn btn-primary btn-lg" onClick={handleInitYear} disabled={actionLoading}>
            {actionLoading ? 'Создание...' : `Инициализировать ${selectedYear} год`}
          </button>
        </div>
      ) : (
        <>
          {/* Текущий баланс */}
          <div className="card mb-xl">
            <div className="card-header">Текущий остаток банка</div>
            <div className="card-value">{formatMoney(bankBalance)}</div>
            {yearData?.closed && (
              <div className="card-footer">
                <span className="badge badge-neutral">Год закрыт</span>
              </div>
            )}
          </div>

          {/* Квартальные выплаты */}
          <div className="card mb-xl">
            <div className="card-header">Квартальные выплаты</div>
            <div className="quarters-list" style={{ marginTop: 'var(--spacing-md)' }}>
              {quarters.map((q) => (
                <div key={q.quarter} className="quarter-row">
                  <div className="quarter-info">
                    <span className="quarter-name">Q{q.quarter}</span>
                    <span className="quarter-ebitda">
                      EBITDA: {formatMoney(q.ebitda_sum)}
                    </span>
                    <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                      Порог: {formatMoney(q.condition_threshold)}
                    </span>
                    {q.condition_met ? (
                      <span className="badge badge-success">✓ Условие</span>
                    ) : (
                      <span className="badge badge-neutral">○ Условие</span>
                    )}
                  </div>
                  <div className="quarter-actions">
                    {q.payout_done ? (
                      <span className="badge badge-success">✓ Выплачено</span>
                    ) : q.condition_met && isAdmin && !yearData?.closed ? (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setConfirmModal({ type: 'quarter', quarter: q.quarter, amount: q.payout_available })}
                        disabled={actionLoading}
                      >
                        Выплатить {formatMoney(q.payout_available)}
                      </button>
                    ) : (
                      <span className="text-muted">
                        {q.payout_available > 0 ? `Доступно: ${formatMoney(q.payout_available)}` : '—'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Годовая выплата */}
          <div className="card mb-xl">
            <div className="card-header">Годовая выплата</div>
            <div style={{ marginTop: 'var(--spacing-md)' }}>
              <div className="flex-between mb-md">
                <span>EBITDA года:</span>
                <strong>{formatMoney(yearData?.ebitda_sum)}</strong>
              </div>
              <div className="flex-between mb-md">
                <span>Порог:</span>
                <span>{formatMoney(yearData?.condition_threshold)}</span>
              </div>
              <div className="flex-between mb-md">
                <span>Условие:</span>
                {yearData?.condition_met ? (
                  <span className="badge badge-success">✓ Выполнено</span>
                ) : (
                  <span className="badge badge-warning">○ Не выполнено</span>
                )}
              </div>
              <div className="flex-between mb-lg">
                <span>К выплате:</span>
                <strong>{formatMoney(bankBalance)}</strong>
              </div>

              {yearData?.closed ? (
                <div className="alert alert-warning mb-0">
                  Год закрыт {yearData.closed_at && new Date(yearData.closed_at).toLocaleDateString('ru-RU')}
                </div>
              ) : isAdmin ? (
                <button
                  className="btn btn-danger"
                  style={{ width: '100%' }}
                  onClick={() => setConfirmModal({ type: 'year' })}
                  disabled={actionLoading}
                >
                  Закрыть год и выплатить остаток
                </button>
              ) : null}
            </div>
          </div>

          {/* Ручная корректировка */}
          {isAdmin && !yearData?.closed && (
            <div className="card mb-xl">
              <div className="card-header">Ручная корректировка</div>
              {showAdjustForm ? (
                <div style={{ marginTop: 'var(--spacing-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Сумма (+ или -)</label>
                    <input
                      type="text"
                      className="input"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(formatInputValue(e.target.value))}
                      placeholder="-50 000 или 50 000"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Комментарий (обязательно)</label>
                    <input
                      type="text"
                      className="input"
                      value={adjustComment}
                      onChange={(e) => setAdjustComment(e.target.value)}
                      placeholder="Причина корректировки"
                    />
                  </div>
                  <div className="flex gap-sm">
                    <button
                      className="btn btn-primary"
                      onClick={() => setConfirmModal({ type: 'adjust', amount: parseMoney(adjustAmount) || 0 })}
                      disabled={actionLoading || !adjustAmount || !adjustComment.trim()}
                    >
                      Применить
                    </button>
                    <button className="btn btn-secondary" onClick={() => setShowAdjustForm(false)}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 'var(--spacing-md)' }}
                  onClick={() => setShowAdjustForm(true)}
                >
                  + Ручная корректировка
                </button>
              )}
            </div>
          )}

          {/* История операций */}
          <div className="card">
            <div className="card-header">История операций</div>
            {ledger.length === 0 ? (
              <p className="text-muted" style={{ marginTop: 'var(--spacing-md)' }}>
                Нет операций
              </p>
            ) : (
              <div style={{ marginTop: 'var(--spacing-md)' }}>
                {ledger.map((l) => (
                  <div key={l.id} className="ledger-item">
                    <div className="ledger-info">
                      <span className="ledger-date">
                        {new Date(l.created_at).toLocaleDateString('ru-RU')}
                      </span>
                      <span className="ledger-description">
                        {getOperationLabel(l.operation_type, l.quarter)}
                        {l.comment && ` — ${l.comment}`}
                      </span>
                    </div>
                    <div>
                      <span className={`ledger-amount ${l.amount >= 0 ? 'positive' : 'negative'}`}>
                        {l.amount >= 0 ? '+' : ''}{formatMoney(l.amount)}
                      </span>
                      <span className="ledger-balance">→ {formatMoney(l.balance_after)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Модал подтверждения */}
      {confirmModal.type && (
        <div className="modal-overlay" onClick={() => setConfirmModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">
                {confirmModal.type === 'quarter' && `Квартальная выплата Q${confirmModal.quarter}`}
                {confirmModal.type === 'year' && 'Закрытие года'}
                {confirmModal.type === 'adjust' && 'Корректировка банка'}
              </h2>
            </div>
            <div className="modal-body">
              {confirmModal.type === 'quarter' && (
                <p>
                  Выплатить <strong>{formatMoney(confirmModal.amount)}</strong> за Q{confirmModal.quarter}?
                </p>
              )}
              {confirmModal.type === 'year' && (
                <>
                  <p style={{ marginBottom: 'var(--spacing-md)' }}>
                    {yearData?.condition_met
                      ? `Выплатить остаток банка ${formatMoney(bankBalance)} и закрыть ${selectedYear} год?`
                      : `Условие года не выполнено. Остаток ${formatMoney(bankBalance)} сгорит.`}
                  </p>
                  <div className="alert alert-warning">
                    ⚠️ Это действие необратимо. После закрытия года редактирование будет запрещено.
                  </div>
                </>
              )}
              {confirmModal.type === 'adjust' && (
                <p>
                  Применить корректировку <strong>{formatMoney(confirmModal.amount)}</strong>?
                  <br />
                  <span className="text-muted">{adjustComment}</span>
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmModal({ type: null })}>
                Отмена
              </button>
              <button
                className={`btn ${confirmModal.type === 'year' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  if (confirmModal.type === 'quarter') handleQuarterPayout(confirmModal.quarter!)
                  if (confirmModal.type === 'year') handleYearPayout()
                  if (confirmModal.type === 'adjust') handleAdjust()
                }}
                disabled={actionLoading}
              >
                {actionLoading ? 'Выполнение...' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
