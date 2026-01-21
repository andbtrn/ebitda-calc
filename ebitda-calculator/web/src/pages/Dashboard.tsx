import { useState } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useYear } from '../hooks/useYear'
import { formatMoney } from '../lib/supabase'

export default function Dashboard() {
  const { currentWorkspace } = useWorkspace()
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const {
    yearData,
    quarters,
    bankBalance,
    loading,
    error,
    initialized,
    initializeYear,
    months,
  } = useYear(selectedYear)

  const [initLoading, setInitLoading] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const handleInitYear = async () => {
    setInitLoading(true)
    setInitError(null)
    const result = await initializeYear()
    if (result.error) {
      setInitError(result.error)
    }
    setInitLoading(false)
  }

  const filledMonths = months.filter((m) => m.ebitda !== null).length

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
          <h1 className="page-title">Сводка</h1>
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
      {initError && <div className="alert alert-error">{initError}</div>}

      {!initialized ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
          <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Год {selectedYear} не инициализирован</h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
            Создайте структуру года для начала работы
          </p>
          <button
            className="btn btn-primary btn-lg"
            onClick={handleInitYear}
            disabled={initLoading}
          >
            {initLoading ? 'Создание...' : `Инициализировать ${selectedYear} год`}
          </button>
        </div>
      ) : (
        <>
          {/* KPI карточки */}
          <div className="summary-grid">
            <div className="card">
              <div className="card-header">EBITDA за год</div>
              <div className="card-value">{formatMoney(yearData?.ebitda_sum)}</div>
              <div className="card-footer">
                Заполнено {filledMonths} из 12 месяцев
              </div>
            </div>

            <div className="card">
              <div className="card-header">Годовой порог</div>
              <div className="card-value">{formatMoney(yearData?.condition_threshold)}</div>
              <div className="card-footer">
                {yearData?.condition_met ? (
                  <span className="badge badge-success">✓ Условие выполнено</span>
                ) : (
                  <span className="badge badge-warning">○ Условие не выполнено</span>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">Всего бонусов</div>
              <div className="card-value">{formatMoney(yearData?.total_bonus_sum)}</div>
              <div className="card-footer">
                Выплачено сразу: {formatMoney(yearData?.paid_now_sum)}
              </div>
            </div>

            <div className="card">
              <div className="card-header">Остаток в банке</div>
              <div className="card-value">{formatMoney(bankBalance)}</div>
              <div className="card-footer">
                Начислено в банк: {formatMoney(yearData?.to_bank_sum)}
              </div>
            </div>
          </div>

          {/* Статус года */}
          {yearData?.closed && (
            <div className="alert alert-warning mb-xl">
              Год {selectedYear} закрыт {yearData.closed_at && `(${new Date(yearData.closed_at).toLocaleDateString('ru-RU')})`}
            </div>
          )}

          {/* Кварталы */}
          <div className="card">
            <div className="card-header">Кварталы</div>
            <div className="quarters-list" style={{ marginTop: 'var(--spacing-md)' }}>
              {quarters.map((q) => (
                <div key={q.quarter} className="quarter-row">
                  <div className="quarter-info">
                    <span className="quarter-name">Q{q.quarter}</span>
                    <span className="quarter-ebitda">{formatMoney(q.ebitda_sum)}</span>
                    {q.condition_met ? (
                      <span className="badge badge-success">✓ Условие</span>
                    ) : (
                      <span className="badge badge-neutral">○ Условие</span>
                    )}
                  </div>
                  <div className="quarter-actions">
                    {q.payout_done ? (
                      <span className="badge badge-success">✓ Выплачено</span>
                    ) : q.condition_met ? (
                      <span className="badge badge-warning">Доступно {formatMoney(q.payout_available)}</span>
                    ) : (
                      <span className="badge badge-neutral">Ожидание</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
