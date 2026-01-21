import { useState, useMemo, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, CellClassParams, ICellRendererParams, ValueFormatterParams } from 'ag-grid-community'
import { themeQuartz } from 'ag-grid-community'
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
}

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

  // Prepare row data with month names
  const rowData = useMemo<MonthRow[]>(() => {
    return months.map((m) => ({
      ...m,
      monthName: MONTH_NAMES[m.month - 1],
    }))
  }, [months])

  // Money formatter
  const moneyFormatter = (params: ValueFormatterParams) => {
    if (params.value === null || params.value === undefined) return '—'
    return formatMoney(params.value)
  }

  // EBITDA cell renderer with click-to-edit
  const EbitdaCellRenderer = useCallback((params: ICellRendererParams<MonthRow>) => {
    const data = params.data
    if (!data) return null

    const canEdit = !data.locked && !yearData?.closed && isAdmin

    return (
      <span
        onClick={() => canEdit && handleOpenEditModal(data.month, data.ebitda)}
        style={{
          cursor: canEdit ? 'pointer' : 'default',
          padding: '4px 8px',
          borderRadius: '3px',
          display: 'inline-block',
        }}
        className={canEdit ? 'input-inline' : ''}
      >
        {data.ebitda !== null ? formatMoney(data.ebitda) : '—'}
      </span>
    )
  }, [isAdmin, yearData?.closed, handleOpenEditModal])

  // Lock button cell renderer
  const LockCellRenderer = useCallback((params: ICellRendererParams<MonthRow>) => {
    const data = params.data
    if (!data) return null

    if (yearData?.closed) {
      return <span>🔒</span>
    }

    if (!isAdmin) return null

    return (
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => handleToggleLock(data.month, data.locked)}
        title={data.locked ? 'Разблокировать' : 'Заблокировать'}
        disabled={saving}
      >
        {data.locked ? '🔒' : '🔓'}
      </button>
    )
  }, [isAdmin, yearData?.closed, saving, handleToggleLock])

  // Column definitions
  const columnDefs = useMemo((): ColDef<MonthRow>[] => {
    const cols: ColDef<MonthRow>[] = [
      {
        field: 'monthName',
        headerName: 'Месяц',
        width: 120,
        pinned: 'left',
        cellStyle: { fontWeight: '600' },
      },
      {
        field: 'ebitda',
        headerName: 'EBITDA',
        width: 130,
        cellRenderer: EbitdaCellRenderer,
        cellClass: (params: CellClassParams<MonthRow>) => {
          return params.data?.ebitda === null ? 'ag-cell-empty' : ''
        },
      },
      {
        field: 'monthly_base',
        headerName: 'База',
        width: 110,
        valueFormatter: moneyFormatter,
        cellStyle: { color: '#9b9a97' },
        type: 'rightAligned',
      },
      {
        field: 'retention',
        headerName: 'Удержание',
        width: 110,
        valueFormatter: moneyFormatter,
        type: 'rightAligned',
      },
      {
        field: 'growth_bonus',
        headerName: 'Рост',
        width: 110,
        valueFormatter: moneyFormatter,
        type: 'rightAligned',
      },
      {
        field: 'total_bonus',
        headerName: 'Бонус',
        width: 110,
        valueFormatter: moneyFormatter,
        cellStyle: { fontWeight: '600' },
        type: 'rightAligned',
      },
      {
        field: 'paid_now',
        headerName: 'Сейчас',
        width: 110,
        valueFormatter: moneyFormatter,
        type: 'rightAligned',
      },
      {
        field: 'to_bank',
        headerName: 'В банк',
        width: 110,
        valueFormatter: moneyFormatter,
        type: 'rightAligned',
      },
      {
        field: 'locked',
        headerName: '',
        width: 60,
        cellRenderer: LockCellRenderer,
        sortable: false,
        filter: false,
      },
    ]
    return cols
  }, [EbitdaCellRenderer, LockCellRenderer])

  // Default column settings
  const defaultColDef = useMemo<ColDef>(() => ({
    sortable: true,
    resizable: true,
  }), [])

  // Row class rules for locked rows
  const getRowClass = useCallback((params: { data?: MonthRow }) => {
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
        <div className="ag-grid-wrapper" style={{ height: 'calc(12 * 42px + 90px)' }}>
          <AgGridReact<MonthRow>
            theme={notionTheme}
            rowData={rowData}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowClass={getRowClass}
            pinnedBottomRowData={pinnedBottomRowData}
            domLayout="normal"
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
