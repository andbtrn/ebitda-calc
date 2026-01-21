-- =====================================================
-- Калькулятор мотивации по EBITDA
-- Миграция 001: Базовая схема
-- =====================================================

-- Включаем расширения
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ТАБЛИЦА: workspaces (организации)
-- =====================================================
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- =====================================================
-- ТАБЛИЦА: memberships (участники workspace)
-- =====================================================
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_workspace ON memberships(workspace_id);

-- =====================================================
-- ТАБЛИЦА: configs (версии конфигураций)
-- =====================================================
CREATE TABLE configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    name TEXT,

    -- Параметры мотивации
    fixed_monthly INTEGER NOT NULL DEFAULT 180000,
    annual_ebitda_base INTEGER NOT NULL DEFAULT 10000000,
    kpi_growth_threshold_pct NUMERIC(5,4) NOT NULL DEFAULT 0.10,
    retention_max INTEGER NOT NULL DEFAULT 80000,
    growth_rate NUMERIC(5,4) NOT NULL DEFAULT 0.25,
    bank_split_pct NUMERIC(5,4) NOT NULL DEFAULT 0.50,
    quarter_payout_pct NUMERIC(5,4) NOT NULL DEFAULT 0.50,
    quarterly_condition_pct NUMERIC(5,4) NOT NULL DEFAULT 0.00,
    year_condition_pct NUMERIC(5,4) NOT NULL DEFAULT 0.10,
    tiered_growth_enabled BOOLEAN NOT NULL DEFAULT false,
    tiered_growth_json JSONB DEFAULT '[]'::jsonb,
    quarter_payout_method TEXT NOT NULL DEFAULT 'quarter_accrual'
        CHECK (quarter_payout_method IN ('quarter_accrual', 'current_balance')),

    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (workspace_id, version)
);

CREATE INDEX idx_configs_workspace ON configs(workspace_id);

-- =====================================================
-- ТАБЛИЦА: year_configs (привязка конфигурации к году)
-- =====================================================
CREATE TABLE year_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    config_id UUID NOT NULL REFERENCES configs(id),
    effective_from_month INTEGER NOT NULL DEFAULT 1 CHECK (effective_from_month BETWEEN 1 AND 12),
    locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (workspace_id, year, effective_from_month)
);

CREATE INDEX idx_year_configs_workspace_year ON year_configs(workspace_id, year);

-- =====================================================
-- ТАБЛИЦА: months (месячные данные)
-- =====================================================
CREATE TABLE months (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),

    -- Входные данные
    ebitda INTEGER, -- NULL = не введено
    comment TEXT,
    locked BOOLEAN NOT NULL DEFAULT false,

    -- Расчётные поля
    config_id UUID REFERENCES configs(id),
    monthly_base INTEGER,
    monthly_threshold INTEGER,
    retention INTEGER DEFAULT 0,
    growth_bonus INTEGER DEFAULT 0,
    total_bonus INTEGER DEFAULT 0,
    paid_now INTEGER DEFAULT 0,
    to_bank INTEGER DEFAULT 0,
    bank_balance_after INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (workspace_id, year, month)
);

CREATE INDEX idx_months_workspace_year ON months(workspace_id, year);

-- =====================================================
-- ТАБЛИЦА: quarters (агрегаты кварталов)
-- =====================================================
CREATE TABLE quarters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),

    ebitda_sum INTEGER DEFAULT 0,
    to_bank_sum INTEGER DEFAULT 0,
    condition_threshold INTEGER DEFAULT 0,
    condition_met BOOLEAN DEFAULT false,
    payout_available INTEGER DEFAULT 0,
    payout_done BOOLEAN DEFAULT false,

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (workspace_id, year, quarter)
);

CREATE INDEX idx_quarters_workspace_year ON quarters(workspace_id, year);

-- =====================================================
-- ТАБЛИЦА: years (агрегаты года)
-- =====================================================
CREATE TABLE years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,

    ebitda_sum INTEGER DEFAULT 0,
    total_bonus_sum INTEGER DEFAULT 0,
    paid_now_sum INTEGER DEFAULT 0,
    to_bank_sum INTEGER DEFAULT 0,
    condition_threshold INTEGER DEFAULT 0,
    condition_met BOOLEAN DEFAULT false,
    closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (workspace_id, year)
);

CREATE INDEX idx_years_workspace ON years(workspace_id);

-- =====================================================
-- ТАБЛИЦА: ledger (журнал операций банка)
-- =====================================================
CREATE TABLE ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,

    operation_type TEXT NOT NULL CHECK (operation_type IN (
        'month_accrual',
        'quarter_payout',
        'year_payout',
        'manual_adjustment',
        'recalc_adjustment',
        'year_start'
    )),

    month INTEGER,
    quarter INTEGER,

    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,

    comment TEXT,
    idempotency_key TEXT,

    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_ledger_idempotency ON ledger(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_ledger_workspace_year ON ledger(workspace_id, year);

-- =====================================================
-- ТАБЛИЦА: audit (аудит изменений)
-- =====================================================
CREATE TABLE audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,

    old_values JSONB,
    new_values JSONB,

    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_workspace ON audit(workspace_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit(entity_type, entity_id);

-- =====================================================
-- ФУНКЦИИ: Триггер для updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER months_updated_at
    BEFORE UPDATE ON months
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER quarters_updated_at
    BEFORE UPDATE ON quarters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER years_updated_at
    BEFORE UPDATE ON years
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER year_configs_updated_at
    BEFORE UPDATE ON year_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
