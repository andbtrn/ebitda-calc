import { useState, useMemo, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, CellClassParams, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community'
import { themeQuartz } from 'ag-grid-community'
import Swal from 'sweetalert2'
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
import type { Month } from '../types/database'

// Custom theme based on Quartz with Notion-like styling
const notionTheme = themeQuartz.withParams({
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  fontSize: 13,
  headerFontSize: 12,
  headerFontWeight: 500,
  headerTextColor: '#6b6b6b',
  headerBackgroundColor: '#f7f6f3',
  borderColor: '#e9e9e7',
  rowHoverColor: '#f1f1ef',
  selectedRowBackgroundColor: '#e8f4fd',
  cellTextColor: '#37352f',
  oddRowBackgroundColor: '#ffffff',
  spacing: 8,
  wrapperBorderRadius: 6,
})

interface MonthRow extends Month {
  monthName: string
  isQuarterHeader?: boolean
  quarter?: number
}

export default function Months() {
  const { currentWorkspace, isAdmin } = useWorkspace()
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)
  const availableYears = [currentYear - 1, currentYear, currentYear + 1]

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

  const handleOpenEditModal = useCallback((month: number, currentValue: number | null) => {
    if (!isAdmin) return
    setEditingMonth(month)
    setEditValue(currentValue !== null ? formatNumber(currentValue) : '')
    setEditComment('')
    setEditError(null)
    setShowEditModal(true)
  }, [isAdmin])

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

  const handleToggleLock = useCallback(async (month: number, currentLocked: boolean) => {
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
  }, [currentWorkspace, isAdmin, selectedYear, refresh])

  const handleClearRow = useCallback(async (month: number) => {
    if (!currentWorkspace || !isAdmin || yearData?.closed) return
    const confirmResult = await Swal.fire({
      title: 'Очистить строку?',
      text: 'Вы уверены, что хотите очистить строку?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Очистить',
      cancelButtonText: 'Отмена',
      confirmButtonColor: '#e03e3e',
      focusCancel: true,
    })
    if (!confirmResult.isConfirmed) return

    setSaving(true)
    setActionError(null)

    const result = await updateMonthEbitda(currentWorkspace.id, selectedYear, month, null, null)

    if (!result.success) {
      setActionError(result.error?.message || 'Ошибка очистки')
    } else {
      await refresh()
    }

    setSaving(false)
  }, [currentWorkspace, isAdmin, yearData?.closed, selectedYear, refresh])

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

  const quarterNames: Record<number, string> = {
    1: 'Янв–Мар',
    2: 'Апр–Июн',
    3: 'Июл–Сен',
    4: 'Окт–Дек',
  }

  // Prepare row data with quarter headers
  const rowData = useMemo<MonthRow[]>(() => {
    const sortedMonths = [...months].sort((a, b) => a.month - b.month)
    const rows: MonthRow[] = []
    const workspaceId = currentWorkspace?.id || ''
    const now = new Date().toISOString()

    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const quarterMonths = sortedMonths.filter(
        (m) => Math.floor((m.month - 1) / 3) + 1 === quarter
      )
      if (quarterMonths.length === 0) continue

      const quarterEbitda = quarterMonths.reduce((sum, m) => sum + (m.ebitda || 0), 0)
      const quarterMonthlyBase = quarterMonths.reduce((sum, m) => sum + (m.monthly_base || 0), 0)
      const quarterMonthlyThreshold = quarterMonths.reduce((sum, m) => sum + (m.monthly_threshold || 0), 0)
      const quarterRetention = quarterMonths.reduce((sum, m) => sum + m.retention, 0)
      const quarterGrowth = quarterMonths.reduce((sum, m) => sum + m.growth_bonus, 0)

      rows.push({
        id: `quarter-${selectedYear}-${quarter}`,
        workspace_id: workspaceId,
        year: selectedYear,
        month: 0,
        ebitda: quarterEbitda,
        comment: null,
        locked: true,
        config_id: null,
        monthly_base: quarterMonthlyBase,
        monthly_threshold: quarterMonthlyThreshold,
        retention: quarterRetention,
        growth_bonus: quarterGrowth,
        total_bonus: 0,
        paid_now: 0,
        to_bank: 0,
        bank_balance_after: 0,
        created_at: now,
        updated_at: now,
        monthName: `Q${quarter} ${quarterNames[quarter]}`,
        isQuarterHeader: true,
        quarter,
      })

      quarterMonths.forEach((m) => {
        rows.push({
          ...m,
          monthName: MONTH_NAMES[m.month - 1],
        })
      })
    }

    return rows
  }, [months, currentWorkspace?.id, selectedYear])

  // Money formatter
  const moneyFormatter = (params: ValueFormatterParams) => {
    if (params.data?.isQuarterHeader) {
      const field = params.colDef.field
      if (field !== 'retention' && field !== 'growth_bonus' && field !== 'monthly_base' && field !== 'monthly_threshold') {
        return ''
      }
    }
    if (params.value === null || params.value === undefined) return '—'
    return formatMoney(params.value)
  }

  const MonthNameCellRenderer = useCallback((params: ICellRendererParams<MonthRow>) => {
    const data = params.data
    if (!data) return null
    if (data.isQuarterHeader) {
      return <span className="quarter-row-title">{data.monthName}</span>
    }
    return <span>{data.monthName}</span>
  }, [])

  const TargetCellRenderer = useCallback((params: ICellRendererParams<MonthRow>) => {
    const data = params.data
    if (!data) return null

    const targetValue = typeof params.value === 'number' ? params.value : null
    if (targetValue === null || targetValue === 0) {
      return <span className="text-muted">—</span>
    }

    const progress = data.ebitda && targetValue > 0
      ? Math.min((data.ebitda / targetValue) * 100, 100)
      : 0

    return (
      <div className="target-cell">
        <span className="target-cell-value">{formatMoney(targetValue)}</span>
        <div className="target-cell-bar">
          <div className="target-cell-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    )
  }, [moneyFormatter])

  // EBITDA cell renderer with click-to-edit
  const EbitdaCellRenderer = useCallback((params: ICellRendererParams<MonthRow>) => {
    const data = params.data
    if (!data) return null

    if (data.isQuarterHeader) {
      return <span className="ebitda-cell-value quarter-row-value">{formatMoney(data.ebitda || 0)}</span>
    }

    const canEdit = !data.locked && !yearData?.closed && isAdmin

    return (
      <span
        onClick={() => canEdit && handleOpenEditModal(data.month, data.ebitda)}
        style={{
          cursor: canEdit ? 'pointer' : 'default',
        }}
        className={`ebitda-cell-value${canEdit ? ' input-inline' : ''}`}
      >
        {data.ebitda !== null ? formatMoney(data.ebitda) : '—'}
      </span>
    )
  }, [isAdmin, yearData?.closed, handleOpenEditModal])

  // Lock button cell renderer
  const LockCellRenderer = useCallback((params: ICellRendererParams<MonthRow>) => {
    const data = params.data
    if (!data) return null

    if (data.isQuarterHeader) return null

    if (data.month === 0 || data.id === 'total') {
      return null
    }

    if (yearData?.closed) {
      return <span>🔒</span>
    }

    if (!isAdmin) return null

    const canClear = !data.locked

    return (
      <div className="flex gap-sm">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => handleToggleLock(data.month, data.locked)}
          title={data.locked ? 'Разблокировать' : 'Заблокировать'}
          disabled={saving}
        >
          {data.locked ? '🔒' : '🔓'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => handleClearRow(data.month)}
          title="Очистить строку"
          disabled={saving || !canClear}
        >
          🗑
        </button>
      </div>
    )
  }, [isAdmin, yearData?.closed, saving, handleToggleLock, handleClearRow])

  // Column definitions
  const columnDefs = useMemo((): ColDef<MonthRow>[] => {
    const cols: ColDef<MonthRow>[] = [
      {
        field: 'monthName',
        headerName: 'Месяц',
        width: 120,
        pinned: 'left',
        flex: 0,
        cellRenderer: MonthNameCellRenderer,
        cellStyle: { fontWeight: '600' },
      },
      {
        field: 'ebitda',
        headerName: 'EBITDA',
        width: 130,
        flex: 1,
        cellRenderer: EbitdaCellRenderer,
        cellClass: (params: CellClassParams<MonthRow>) => {
          return params.data?.ebitda === null ? 'ag-cell-empty' : ''
        },
      },
      {
        field: 'monthly_base',
        headerName: 'Цель удержания',
        width: 110,
        flex: 1,
        cellRenderer: TargetCellRenderer,
        cellStyle: { color: '#9b9a97' },
      },
      {
        field: 'monthly_threshold',
        headerName: 'Цель роста',
        width: 110,
        flex: 1,
        cellRenderer: TargetCellRenderer,
        cellStyle: { color: '#9b9a97' },
      },
      {
        field: 'retention',
        headerName: 'Удержание',
        width: 110,
        flex: 1,
        valueFormatter: moneyFormatter,
      },
      {
        field: 'growth_bonus',
        headerName: 'Рост',
        width: 110,
        flex: 1,
        valueFormatter: moneyFormatter,
      },
      {
        field: 'total_bonus',
        headerName: 'Бонус',
        width: 110,
        flex: 1,
        valueFormatter: moneyFormatter,
        cellStyle: { fontWeight: '600' },
      },
      {
        field: 'paid_now',
        headerName: 'Сейчас',
        width: 110,
        flex: 1,
        valueFormatter: moneyFormatter,
      },
      {
        field: 'to_bank',
        headerName: 'В банк',
        width: 110,
        flex: 1,
        valueFormatter: moneyFormatter,
      },
      {
        field: 'locked',
        headerName: '',
        width: 120,
        flex: 0,
        cellRenderer: LockCellRenderer,
        cellClass: 'month-actions-cell',
        sortable: false,
        filter: false,
      },
    ]
    return cols
  }, [EbitdaCellRenderer, LockCellRenderer, MonthNameCellRenderer, TargetCellRenderer])

  // Default column settings
  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    resizable: true,
    flex: 1,
    minWidth: 100,
    cellStyle: { textAlign: 'left' },
  }), [])

  // Row class rules for locked rows
  const getRowClass = useCallback((params: { data?: MonthRow }) => {
    if (params.data?.isQuarterHeader) {
      return 'ag-row-quarter'
    }
    if (params.data?.locked) {
      return 'ag-row-locked'
    }
    return ''
  }, [])

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

  // Pinned bottom row for totals
  const pinnedBottomRowData = useMemo(() => [{
    id: 'total',
    monthName: 'Итого',
    month: 0,
    ebitda: totals.ebitda,
    monthly_base: null,
    retention: totals.retention,
    growth_bonus: totals.growth_bonus,
    total_bonus: totals.total_bonus,
    paid_now: totals.paid_now,
    to_bank: totals.to_bank,
    locked: false,
    workspace_id: '',
    year: selectedYear,
    comment: null,
    config_id: null,
    monthly_threshold: null,
    bank_balance_after: 0,
    created_at: '',
    updated_at: '',
  }], [totals, selectedYear])

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

      <div className="year-tabs" role="tablist" aria-label="Выбор года">
        {availableYears.map((year) => (
          <button
            key={year}
            type="button"
            role="tab"
            aria-selected={year === selectedYear}
            className={`year-tab ${year === selectedYear ? 'is-active' : ''}`}
            onClick={() => setSelectedYear(year)}
          >
            {year} год
          </button>
        ))}
      </div>

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
        <div className="ag-grid-wrapper">
          <AgGridReact<MonthRow>
            theme={notionTheme}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowClass={getRowClass}
            pinnedBottomRowData={pinnedBottomRowData}
            domLayout="autoHeight"
            suppressMovableColumns={true}
            suppressCellFocus={true}
            animateRows={false}
          />
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
