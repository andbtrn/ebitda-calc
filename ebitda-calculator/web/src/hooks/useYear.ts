import { useState, useEffect, useCallback } from 'react'
import { supabase, initYear, recalculateYear } from '../lib/supabase'
import { useWorkspace } from '../contexts/WorkspaceContext'
import type { Month, Quarter, Year, Config, Ledger } from '../types/database'

interface UseYearReturn {
  year: number
  setYear: (year: number) => void
  months: Month[]
  quarters: Quarter[]
  yearData: Year | null
  config: Config | null
  ledger: Ledger[]
  bankBalance: number
  loading: boolean
  error: string | null
  initialized: boolean
  initializeYear: () => Promise<{ error: string | null }>
  recalculate: () => Promise<{ error: string | null }>
  refresh: () => Promise<void>
}

export function useYear(initialYear?: number): UseYearReturn {
  const { currentWorkspace } = useWorkspace()
  const [year, setYear] = useState(initialYear || new Date().getFullYear())
  const [months, setMonths] = useState<Month[]>([])
  const [quarters, setQuarters] = useState<Quarter[]>([])
  const [yearData, setYearData] = useState<Year | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [ledger, setLedger] = useState<Ledger[]>([])
  const [bankBalance, setBankBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  const workspaceId = currentWorkspace?.id

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Проверяем, инициализирован ли год
      const { data: yearExists } = await supabase
        .from('years')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('year', year)
        .single()

      setInitialized(!!yearExists)

      if (!yearExists) {
        setMonths([])
        setQuarters([])
        setYearData(null)
        setConfig(null)
        setLedger([])
        setBankBalance(0)
        setLoading(false)
        return
      }

      // Загружаем все данные параллельно
      const [
        { data: monthsData },
        { data: quartersData },
        { data: yearDataResult },
        { data: yearConfig },
        { data: ledgerData },
      ] = await Promise.all([
        supabase
          .from('months')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('year', year)
          .order('month'),
        supabase
          .from('quarters')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('year', year)
          .order('quarter'),
        supabase
          .from('years')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('year', year)
          .single(),
        supabase
          .from('year_configs')
          .select('*, config:configs(*)')
          .eq('workspace_id', workspaceId)
          .eq('year', year)
          .order('effective_from_month')
          .limit(1)
          .single(),
        supabase
          .from('ledger')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('year', year)
          .order('created_at', { ascending: false }),
      ])

      setMonths(monthsData || [])
      setQuarters(quartersData || [])
      setYearData(yearDataResult)
      setConfig(yearConfig?.config as unknown as Config || null)
      setLedger(ledgerData || [])

      // Рассчитываем текущий баланс банка
      const lastMonth = monthsData?.[monthsData.length - 1]
      const totalPayouts = (ledgerData || [])
        .filter(
          (l) =>
            l.operation_type === 'quarter_payout' ||
            l.operation_type === 'year_payout'
        )
        .reduce((sum, l) => sum + Math.abs(l.amount), 0)
      const adjustments = (ledgerData || [])
        .filter((l) => l.operation_type === 'manual_adjustment')
        .reduce((sum, l) => sum + l.amount, 0)

      const balance =
        (lastMonth?.bank_balance_after || 0) - totalPayouts + adjustments
      setBankBalance(Math.max(0, balance))
    } catch (err) {
      console.error('Error fetching year data:', err)
      setError('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, year])

  useEffect(() => {
    refresh()
  }, [refresh])

  const initializeYear = async (): Promise<{ error: string | null }> => {
    if (!workspaceId) {
      return { error: 'Организация не выбрана' }
    }

    const result = await initYear(workspaceId, year)

    if (!result.success) {
      return { error: result.error?.message || 'Ошибка инициализации года' }
    }

    await refresh()
    return { error: null }
  }

  const recalculate = async (): Promise<{ error: string | null }> => {
    if (!workspaceId) {
      return { error: 'Организация не выбрана' }
    }

    const result = await recalculateYear(workspaceId, year)

    if (!result.success) {
      return { error: result.error?.message || 'Ошибка пересчёта' }
    }

    await refresh()
    return { error: null }
  }

  return {
    year,
    setYear,
    months,
    quarters,
    yearData,
    config,
    ledger,
    bankBalance,
    loading,
    error,
    initialized,
    initializeYear,
    recalculate,
    refresh,
  }
}
