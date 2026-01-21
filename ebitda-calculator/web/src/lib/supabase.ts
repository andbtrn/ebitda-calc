import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// Типы для RPC функций
export interface RPCResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

// Обёртки для RPC вызовов
export async function rpcCall<T>(
  functionName: string,
  params: Record<string, unknown>
): Promise<RPCResponse<T>> {
  const { data, error } = await supabase.rpc(functionName, params)

  if (error) {
    console.error('RPC Error:', error)
    return {
      success: false,
      error: {
        code: 'RPC_ERROR',
        message: error.message || 'Ошибка выполнения операции',
      },
    }
  }

  return data as RPCResponse<T>
}

// Инициализация года
export async function initYear(workspaceId: string, year: number) {
  return rpcCall<{ year: number }>('init_year', {
    p_workspace_id: workspaceId,
    p_year: year,
  })
}

// Обновление EBITDA месяца
export async function updateMonthEbitda(
  workspaceId: string,
  year: number,
  month: number,
  ebitda: number | null,
  comment?: string
) {
  return rpcCall('update_month_ebitda', {
    p_workspace_id: workspaceId,
    p_year: year,
    p_month: month,
    p_ebitda: ebitda,
    p_comment: comment,
  })
}

// Блокировка месяца
export async function toggleMonthLock(
  workspaceId: string,
  year: number,
  month: number,
  locked: boolean
) {
  return rpcCall('toggle_month_lock', {
    p_workspace_id: workspaceId,
    p_year: year,
    p_month: month,
    p_locked: locked,
  })
}

// Пересчёт года
export async function recalculateYear(workspaceId: string, year: number) {
  return rpcCall('recalculate_year', {
    p_workspace_id: workspaceId,
    p_year: year,
  })
}

// Квартальная выплата
export async function executeQuarterPayout(
  workspaceId: string,
  year: number,
  quarter: number,
  customAmount?: number,
  comment?: string
) {
  return rpcCall<{ quarter: number; amount: number; balance_after: number }>(
    'execute_quarter_payout',
    {
      p_workspace_id: workspaceId,
      p_year: year,
      p_quarter: quarter,
      p_custom_amount: customAmount ?? null,
      p_comment: comment ?? null,
    }
  )
}

// Годовая выплата
export async function executeYearPayout(workspaceId: string, year: number) {
  return rpcCall<{
    year: number
    condition_met: boolean
    amount?: number
    burned?: number
    message: string
  }>('execute_year_payout', {
    p_workspace_id: workspaceId,
    p_year: year,
  })
}

// Ручная корректировка банка
export async function adjustBank(
  workspaceId: string,
  year: number,
  amount: number,
  comment: string
) {
  return rpcCall<{ amount: number; balance_after: number }>('adjust_bank', {
    p_workspace_id: workspaceId,
    p_year: year,
    p_amount: amount,
    p_comment: comment,
  })
}

// Создание workspace
export async function createWorkspace(name: string) {
  return rpcCall<{ workspace_id: string; config_id: string }>('create_workspace', {
    p_name: name,
  })
}

// Создание версии конфигурации
export async function createConfigVersion(
  workspaceId: string,
  name: string,
  config: {
    fixed_monthly: number
    annual_ebitda_base: number
    kpi_growth_threshold_pct: number
    retention_max: number
    growth_rate: number
    bank_split_pct: number
    quarter_payout_pct: number
    quarterly_condition_pct: number
    year_condition_pct: number
    tiered_growth_enabled: boolean
    tiered_growth_json: unknown[]
    quarter_payout_method: string
  }
) {
  return rpcCall<{ id: string; version: number }>('create_config_version', {
    p_workspace_id: workspaceId,
    p_name: name,
    p_fixed_monthly: config.fixed_monthly,
    p_annual_ebitda_base: config.annual_ebitda_base,
    p_kpi_growth_threshold_pct: config.kpi_growth_threshold_pct,
    p_retention_max: config.retention_max,
    p_growth_rate: config.growth_rate,
    p_bank_split_pct: config.bank_split_pct,
    p_quarter_payout_pct: config.quarter_payout_pct,
    p_quarterly_condition_pct: config.quarterly_condition_pct,
    p_year_condition_pct: config.year_condition_pct,
    p_tiered_growth_enabled: config.tiered_growth_enabled,
    p_tiered_growth_json: config.tiered_growth_json,
    p_quarter_payout_method: config.quarter_payout_method,
  })
}

// Назначение конфигурации году
export async function assignConfigToYear(
  workspaceId: string,
  year: number,
  configId: string,
  effectiveFromMonth: number = 1
) {
  return rpcCall('assign_config_to_year', {
    p_workspace_id: workspaceId,
    p_year: year,
    p_config_id: configId,
    p_effective_from_month: effectiveFromMonth,
  })
}

// Форматирование денег
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('ru-RU', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value) + ' ₽'
}

// Форматирование числа с пробелами (без ₽)
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return new Intl.NumberFormat('ru-RU', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

// Форматирование строки ввода с пробелами
export function formatInputValue(value: string): string {
  // Убираем все кроме цифр
  const cleaned = value.replace(/[^\d]/g, '')
  if (!cleaned) return ''
  const num = parseInt(cleaned, 10)
  if (isNaN(num)) return ''
  return formatNumber(num)
}

// Парсинг денег
export function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[^\d-]/g, '')
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? null : num
}

// Названия месяцев
export const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

export const QUARTER_MONTHS = {
  1: [1, 2, 3],
  2: [4, 5, 6],
  3: [7, 8, 9],
  4: [10, 11, 12],
}
