import type { ReactNode } from 'react'
import { formatMoney } from '../lib/supabase'

interface QuarterProgressProps {
  quarter: number
  ebitdaSum: number
  retentionTarget: number
  growthTarget: number
  headerRight?: ReactNode
}

function formatCompact(value: number): string {
  if (value >= 1000000) {
    const m = value / 1000000
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`
  }
  if (value >= 1000) {
    const k = value / 1000
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(0)}K`
  }
  return value.toString()
}

export default function QuarterProgress({
  quarter,
  ebitdaSum,
  retentionTarget,
  growthTarget,
  headerRight,
}: QuarterProgressProps) {
  const retentionPercent = retentionTarget > 0 ? (ebitdaSum / retentionTarget) * 100 : 0
  const growthPercent = growthTarget > 0 ? (ebitdaSum / growthTarget) * 100 : 0

  const retentionDiff = ebitdaSum - retentionTarget
  const growthDiff = ebitdaSum - growthTarget

  const retentionMet = ebitdaSum >= retentionTarget
  const growthMet = ebitdaSum >= growthTarget

  const quarterNames: Record<number, string> = {
    1: 'Янв–Мар',
    2: 'Апр–Июн',
    3: 'Июл–Сен',
    4: 'Окт–Дек',
  }

  return (
    <div className="quarter-progress-compact">
      <div className="quarter-progress-compact-header">
        <div className="quarter-progress-compact-header-left">
          <span className="quarter-progress-compact-title">Q{quarter}</span>
          <span className="quarter-progress-compact-subtitle">{quarterNames[quarter]}</span>
        </div>
        {headerRight && (
          <div className="quarter-progress-compact-header-right">
            {headerRight}
          </div>
        )}
      </div>

      {/* Удержание */}
      <div className="progress-row">
        <span className="progress-row-label">Удержание:</span>
        <span className="progress-row-values">
          {formatMoney(ebitdaSum)} / {formatMoney(retentionTarget)}
        </span>
        <div className="progress-row-bar">
          <div
            className={`progress-row-bar-fill ${retentionMet ? 'fill-success' : 'fill-warning'}`}
            style={{ width: `${Math.min(retentionPercent, 100)}%` }}
          />
        </div>
        <span className={`progress-row-percent ${retentionMet ? 'text-success' : 'text-warning'}`}>
          {Math.round(retentionPercent)}%
        </span>
        <span className={`progress-row-status ${retentionMet ? 'text-success' : 'text-warning'}`}>
          {retentionMet ? '✓' : '○'}
        </span>
        {retentionDiff !== 0 && (
          <span className={`progress-row-diff ${retentionDiff >= 0 ? 'text-success' : 'text-danger'}`}>
            {retentionDiff >= 0 ? '+' : ''}{formatCompact(retentionDiff)}
          </span>
        )}
      </div>

      {/* Рост */}
      <div className="progress-row">
        <span className="progress-row-label">Рост:</span>
        <span className="progress-row-values">
          {formatMoney(ebitdaSum)} / {formatMoney(growthTarget)}
        </span>
        <div className="progress-row-bar">
          <div
            className={`progress-row-bar-fill ${growthMet ? 'fill-success' : 'fill-warning'}`}
            style={{ width: `${Math.min(growthPercent, 100)}%` }}
          />
        </div>
        <span className={`progress-row-percent ${growthMet ? 'text-success' : 'text-warning'}`}>
          {Math.round(growthPercent)}%
        </span>
        <span className={`progress-row-status ${growthMet ? 'text-success' : 'text-warning'}`}>
          {growthMet ? '✓' : '○'}
        </span>
        {growthDiff !== 0 && (
          <span className={`progress-row-diff ${growthDiff >= 0 ? 'text-success' : 'text-danger'}`}>
            {growthDiff >= 0 ? '+' : ''}{formatCompact(growthDiff)}
          </span>
        )}
      </div>
    </div>
  )
}
