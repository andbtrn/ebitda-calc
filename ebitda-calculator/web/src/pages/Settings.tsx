import { useState, useEffect } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { useYear } from '../hooks/useYear'
import { supabase, createConfigVersion, assignConfigToYear, formatMoney, formatNumber, parseMoney } from '../lib/supabase'
import type { Config } from '../types/database'

export default function Settings() {
  const { currentWorkspace, isAdmin } = useWorkspace()
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)

  const { config, yearData, initialized, refresh } = useYear(selectedYear)

  const [configs, setConfigs] = useState<Config[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(true)

  // Форма
  const [formData, setFormData] = useState({
    name: '',
    fixed_monthly: 180000,
    annual_ebitda_base: 10000000,
    kpi_growth_threshold_pct: 0.10,
    retention_max: 80000,
    growth_rate: 0.25,
    bank_split_pct: 0.50,
    quarter_payout_pct: 0.50,
    quarterly_condition_pct: 0.00,
    year_condition_pct: 0.10,
    tiered_growth_enabled: false,
    tiered_growth_json: '[]',
    quarter_payout_method: 'quarter_accrual' as 'quarter_accrual' | 'current_balance',
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Загрузка конфигураций
  useEffect(() => {
    if (!currentWorkspace) return

    const loadConfigs = async () => {
      setLoadingConfigs(true)
      const { data } = await supabase
        .from('configs')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .order('version', { ascending: false })

      setConfigs(data || [])
      setLoadingConfigs(false)
    }

    loadConfigs()
  }, [currentWorkspace])

  // Заполнение формы из текущей конфигурации
  useEffect(() => {
    if (config) {
      setFormData({
        name: `${selectedYear} v${(config.version || 0) + 1}`,
        fixed_monthly: config.fixed_monthly,
        annual_ebitda_base: config.annual_ebitda_base,
        kpi_growth_threshold_pct: Number(config.kpi_growth_threshold_pct),
        retention_max: config.retention_max,
        growth_rate: Number(config.growth_rate),
        bank_split_pct: Number(config.bank_split_pct),
        quarter_payout_pct: Number(config.quarter_payout_pct),
        quarterly_condition_pct: Number(config.quarterly_condition_pct),
        year_condition_pct: Number(config.year_condition_pct),
        tiered_growth_enabled: config.tiered_growth_enabled,
        tiered_growth_json: JSON.stringify(config.tiered_growth_json || [], null, 2),
        quarter_payout_method: config.quarter_payout_method,
      })
    }
  }, [config, selectedYear])

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleCreateVersion = async () => {
    if (!currentWorkspace) return

    setError(null)
    setSuccess(null)
    setSaving(true)

    // Валидация JSON
    let tieredJson: unknown[]
    try {
      tieredJson = JSON.parse(formData.tiered_growth_json)
      if (!Array.isArray(tieredJson)) throw new Error('Должен быть массив')
    } catch {
      setError('Некорректный JSON зон градации')
      setSaving(false)
      return
    }

    const result = await createConfigVersion(currentWorkspace.id, formData.name, {
      fixed_monthly: formData.fixed_monthly,
      annual_ebitda_base: formData.annual_ebitda_base,
      kpi_growth_threshold_pct: formData.kpi_growth_threshold_pct,
      retention_max: formData.retention_max,
      growth_rate: formData.growth_rate,
      bank_split_pct: formData.bank_split_pct,
      quarter_payout_pct: formData.quarter_payout_pct,
      quarterly_condition_pct: formData.quarterly_condition_pct,
      year_condition_pct: formData.year_condition_pct,
      tiered_growth_enabled: formData.tiered_growth_enabled,
      tiered_growth_json: tieredJson,
      quarter_payout_method: formData.quarter_payout_method,
    })

    if (!result.success) {
      setError(result.error?.message || 'Ошибка создания')
      setSaving(false)
      return
    }

    // Назначаем новую конфигурацию году
    if (initialized && result.data?.id) {
      const assignResult = await assignConfigToYear(currentWorkspace.id, selectedYear, result.data.id)
      if (!assignResult.success) {
        setError(assignResult.error?.message || 'Ошибка назначения')
        setSaving(false)
        return
      }
    }

    setSuccess(`Версия ${result.data?.version} создана и назначена`)

    // Обновляем список
    const { data } = await supabase
      .from('configs')
      .select('*')
      .eq('workspace_id', currentWorkspace.id)
      .order('version', { ascending: false })
    setConfigs(data || [])

    await refresh()
    setSaving(false)
  }

  const monthlyBase = Math.round(formData.annual_ebitda_base / 12)
  const monthlyThreshold = Math.round(monthlyBase * (1 + formData.kpi_growth_threshold_pct))

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Настройки</h1>
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
      {success && <div className="alert alert-success">{success}</div>}

      {yearData?.closed && (
        <div className="alert alert-warning mb-lg">
          Год закрыт. Изменение настроек запрещено.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 'var(--spacing-xl)' }}>
        {/* Форма */}
        <div>
          {config && (
            <div className="card mb-lg">
              <div className="card-header">Текущая конфигурация</div>
              <p style={{ marginTop: 'var(--spacing-sm)' }}>
                <strong>v{config.version}</strong> «{config.name || 'Без названия'}»
                <br />
                <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                  Создана: {new Date(config.created_at).toLocaleDateString('ru-RU')}
                </span>
              </p>
            </div>
          )}

          <div className="card">
            <div className="card-header">Параметры мотивации</div>

            <div className="settings-form" style={{ marginTop: 'var(--spacing-lg)' }}>
              <div className="form-section">
                <div className="form-section-title">Базовые параметры</div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Фиксированный оклад</label>
                    <input
                      type="text"
                      className="input"
                      value={formatNumber(formData.fixed_monthly)}
                      onChange={(e) => handleChange('fixed_monthly', parseMoney(e.target.value) || 0)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">₽ / месяц</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Годовая база EBITDA</label>
                    <input
                      type="text"
                      className="input"
                      value={formatNumber(formData.annual_ebitda_base)}
                      onChange={(e) => handleChange('annual_ebitda_base', parseMoney(e.target.value) || 0)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">₽ / год → {formatMoney(monthlyBase)} / мес</p>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Порог роста KPI</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={formData.kpi_growth_threshold_pct * 100}
                      onChange={(e) => handleChange('kpi_growth_threshold_pct', Number(e.target.value) / 100)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">% → порог {formatMoney(monthlyThreshold)}</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Макс. удержание</label>
                    <input
                      type="text"
                      className="input"
                      value={formatNumber(formData.retention_max)}
                      onChange={(e) => handleChange('retention_max', parseMoney(e.target.value) || 0)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">₽</p>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Ставка роста</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    style={{ maxWidth: '200px' }}
                    value={formData.growth_rate * 100}
                    onChange={(e) => handleChange('growth_rate', Number(e.target.value) / 100)}
                    disabled={!isAdmin || yearData?.closed}
                  />
                  <p className="form-hint">% от суммы выше порога</p>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Распределение и выплаты</div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Доля в банк</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={formData.bank_split_pct * 100}
                      onChange={(e) => handleChange('bank_split_pct', Number(e.target.value) / 100)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">%</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Доля квартальной выплаты</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={formData.quarter_payout_pct * 100}
                      onChange={(e) => handleChange('quarter_payout_pct', Number(e.target.value) / 100)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">% от банка</p>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Условие квартала</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={formData.quarterly_condition_pct * 100}
                      onChange={(e) => handleChange('quarterly_condition_pct', Number(e.target.value) / 100)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">% выше базы</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Условие года</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={formData.year_condition_pct * 100}
                      onChange={(e) => handleChange('year_condition_pct', Number(e.target.value) / 100)}
                      disabled={!isAdmin || yearData?.closed}
                    />
                    <p className="form-hint">% выше базы</p>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Метод квартальной выплаты</label>
                  <div className="toggle-group">
                    <button
                      type="button"
                      className={`toggle-option ${formData.quarter_payout_method === 'quarter_accrual' ? 'active' : ''}`}
                      onClick={() => handleChange('quarter_payout_method', 'quarter_accrual')}
                      disabled={!isAdmin || yearData?.closed}
                    >
                      От начислений квартала
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${formData.quarter_payout_method === 'current_balance' ? 'active' : ''}`}
                      onClick={() => handleChange('quarter_payout_method', 'current_balance')}
                      disabled={!isAdmin || yearData?.closed}
                    >
                      От текущего баланса
                    </button>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Градационный рост</div>

                <div className="form-group">
                  <div className="toggle-group">
                    <button
                      type="button"
                      className={`toggle-option ${!formData.tiered_growth_enabled ? 'active' : ''}`}
                      onClick={() => handleChange('tiered_growth_enabled', false)}
                      disabled={!isAdmin || yearData?.closed}
                    >
                      Выкл
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${formData.tiered_growth_enabled ? 'active' : ''}`}
                      onClick={() => handleChange('tiered_growth_enabled', true)}
                      disabled={!isAdmin || yearData?.closed}
                    >
                      Вкл
                    </button>
                  </div>
                </div>

                {formData.tiered_growth_enabled && (
                  <div className="form-group">
                    <label className="form-label">Зоны градации (JSON)</label>
                    <textarea
                      className="input"
                      rows={6}
                      value={formData.tiered_growth_json}
                      onChange={(e) => handleChange('tiered_growth_json', e.target.value)}
                      disabled={!isAdmin || yearData?.closed}
                      style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-xs)' }}
                    />
                    <p className="form-hint">
                      Формат: [{'{"from":"threshold","to":1200000,"rate":0.20}'}, ...]
                    </p>
                  </div>
                )}
              </div>

              {isAdmin && !yearData?.closed && (
                <div className="form-group">
                  <label className="form-label">Название версии</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="2026 v2"
                  />
                </div>
              )}

              {isAdmin && !yearData?.closed && (
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleCreateVersion}
                  disabled={saving}
                  style={{ marginTop: 'var(--spacing-md)' }}
                >
                  {saving ? 'Сохранение...' : 'Создать новую версию настроек'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Список версий */}
        <div>
          <div className="card">
            <div className="card-header">Версии конфигураций</div>
            {loadingConfigs ? (
              <div className="loading" style={{ padding: 'var(--spacing-lg)' }}>
                <div className="spinner" />
              </div>
            ) : configs.length === 0 ? (
              <p className="text-muted" style={{ marginTop: 'var(--spacing-md)' }}>
                Нет конфигураций
              </p>
            ) : (
              <div style={{ marginTop: 'var(--spacing-md)' }}>
                {configs.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: 'var(--spacing-sm) 0',
                      borderBottom: '1px solid var(--color-border-light)',
                    }}
                  >
                    <div className="flex-between">
                      <div>
                        <strong>v{c.version}</strong>
                        <span className="text-muted" style={{ marginLeft: 'var(--spacing-sm)' }}>
                          {c.name || 'Без названия'}
                        </span>
                      </div>
                      {config?.id === c.id && (
                        <span className="badge badge-success">Активна</span>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                      {new Date(c.created_at).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
