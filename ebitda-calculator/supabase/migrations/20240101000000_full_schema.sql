-- =====================================================
-- EBITDA Калькулятор мотивации
-- Полная миграция для Supabase Cloud
-- Версия: 1.0.0
-- =====================================================

-- =====================================================
-- ЧАСТЬ 1: БАЗОВЫЕ ТАБЛИЦЫ
-- =====================================================

-- Workspaces (организации)
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Memberships (связь пользователей с организациями)
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_workspace ON memberships(workspace_id);

-- Configs (версии конфигураций мотивации)
CREATE TABLE IF NOT EXISTS configs (
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

CREATE INDEX IF NOT EXISTS idx_configs_workspace ON configs(workspace_id);

-- Year_configs (привязка конфигурации к году)
CREATE TABLE IF NOT EXISTS year_configs (
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

CREATE INDEX IF NOT EXISTS idx_year_configs_workspace_year ON year_configs(workspace_id, year);

-- Months (месячные данные)
CREATE TABLE IF NOT EXISTS months (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),

    -- Входные данные
    ebitda INTEGER,
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

CREATE INDEX IF NOT EXISTS idx_months_workspace_year ON months(workspace_id, year);

-- Quarters (агрегаты кварталов)
CREATE TABLE IF NOT EXISTS quarters (
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

CREATE INDEX IF NOT EXISTS idx_quarters_workspace_year ON quarters(workspace_id, year);

-- Years (агрегаты года)
CREATE TABLE IF NOT EXISTS years (
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

CREATE INDEX IF NOT EXISTS idx_years_workspace ON years(workspace_id);

-- Ledger (журнал операций банка) — КРИТИЧНО ДЛЯ ИДЕМПОТЕНТНОСТИ
CREATE TABLE IF NOT EXISTS ledger (
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

-- КРИТИЧНО: Уникальный индекс для идемпотентности выплат
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency
    ON ledger(workspace_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_workspace_year ON ledger(workspace_id, year);

-- Audit (журнал аудита)
CREATE TABLE IF NOT EXISTS audit (
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

CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity_type, entity_id);

-- =====================================================
-- ЧАСТЬ 2: ТРИГГЕРЫ ДЛЯ updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS months_updated_at ON months;
CREATE TRIGGER months_updated_at
    BEFORE UPDATE ON months
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS quarters_updated_at ON quarters;
CREATE TRIGGER quarters_updated_at
    BEFORE UPDATE ON quarters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS years_updated_at ON years;
CREATE TRIGGER years_updated_at
    BEFORE UPDATE ON years
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS year_configs_updated_at ON year_configs;
CREATE TRIGGER year_configs_updated_at
    BEFORE UPDATE ON year_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- ЧАСТЬ 3: RLS ПОЛИТИКИ
-- =====================================================

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE year_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE months ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarters ENABLE ROW LEVEL SECURITY;
ALTER TABLE years ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;

-- Вспомогательные функции для RLS
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM memberships
        WHERE workspace_id = ws_id AND user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM memberships
        WHERE workspace_id = ws_id AND user_id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Политики для workspaces
DROP POLICY IF EXISTS "ws_select" ON workspaces;
CREATE POLICY "ws_select" ON workspaces FOR SELECT
    USING (is_workspace_member(id));

DROP POLICY IF EXISTS "ws_insert" ON workspaces;
CREATE POLICY "ws_insert" ON workspaces FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ws_update" ON workspaces;
CREATE POLICY "ws_update" ON workspaces FOR UPDATE
    USING (is_workspace_admin(id));

-- Политики для memberships
DROP POLICY IF EXISTS "mem_select" ON memberships;
CREATE POLICY "mem_select" ON memberships FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "mem_insert" ON memberships;
CREATE POLICY "mem_insert" ON memberships FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "mem_update" ON memberships;
CREATE POLICY "mem_update" ON memberships FOR UPDATE
    USING (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "mem_delete" ON memberships;
CREATE POLICY "mem_delete" ON memberships FOR DELETE
    USING (is_workspace_admin(workspace_id));

-- Политики для configs
DROP POLICY IF EXISTS "cfg_select" ON configs;
CREATE POLICY "cfg_select" ON configs FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "cfg_insert" ON configs;
CREATE POLICY "cfg_insert" ON configs FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

-- Политики для year_configs
DROP POLICY IF EXISTS "yc_select" ON year_configs;
CREATE POLICY "yc_select" ON year_configs FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "yc_insert" ON year_configs;
CREATE POLICY "yc_insert" ON year_configs FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "yc_update" ON year_configs;
CREATE POLICY "yc_update" ON year_configs FOR UPDATE
    USING (is_workspace_admin(workspace_id) AND NOT locked);

-- Политики для months
DROP POLICY IF EXISTS "mon_select" ON months;
CREATE POLICY "mon_select" ON months FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "mon_insert" ON months;
CREATE POLICY "mon_insert" ON months FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "mon_update" ON months;
CREATE POLICY "mon_update" ON months FOR UPDATE
    USING (
        is_workspace_admin(workspace_id)
        AND NOT locked
        AND NOT EXISTS (
            SELECT 1 FROM years
            WHERE years.workspace_id = months.workspace_id
            AND years.year = months.year
            AND years.closed = true
        )
    );

-- Политики для quarters
DROP POLICY IF EXISTS "qtr_select" ON quarters;
CREATE POLICY "qtr_select" ON quarters FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "qtr_insert" ON quarters;
CREATE POLICY "qtr_insert" ON quarters FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "qtr_update" ON quarters;
CREATE POLICY "qtr_update" ON quarters FOR UPDATE
    USING (is_workspace_admin(workspace_id));

-- Политики для years
DROP POLICY IF EXISTS "yr_select" ON years;
CREATE POLICY "yr_select" ON years FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "yr_insert" ON years;
CREATE POLICY "yr_insert" ON years FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "yr_update" ON years;
CREATE POLICY "yr_update" ON years FOR UPDATE
    USING (is_workspace_admin(workspace_id));

-- Политики для ledger
DROP POLICY IF EXISTS "ldg_select" ON ledger;
CREATE POLICY "ldg_select" ON ledger FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "ldg_insert" ON ledger;
CREATE POLICY "ldg_insert" ON ledger FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

-- Политики для audit
DROP POLICY IF EXISTS "aud_select" ON audit;
CREATE POLICY "aud_select" ON audit FOR SELECT
    USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "aud_insert" ON audit;
CREATE POLICY "aud_insert" ON audit FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================
-- ЧАСТЬ 4: RPC ФУНКЦИИ
-- =====================================================

-- Получить конфигурацию для месяца
CREATE OR REPLACE FUNCTION get_config_for_month(
    p_workspace_id UUID,
    p_year INTEGER,
    p_month INTEGER
)
RETURNS UUID AS $$
DECLARE
    v_config_id UUID;
BEGIN
    SELECT config_id INTO v_config_id
    FROM year_configs
    WHERE workspace_id = p_workspace_id
      AND year = p_year
      AND effective_from_month <= p_month
    ORDER BY effective_from_month DESC
    LIMIT 1;

    RETURN v_config_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Расчёт значений месяца
CREATE OR REPLACE FUNCTION calculate_month_values(
    p_ebitda INTEGER,
    p_config configs,
    p_prev_balance INTEGER
)
RETURNS TABLE (
    monthly_base INTEGER,
    monthly_threshold INTEGER,
    retention INTEGER,
    growth_bonus INTEGER,
    total_bonus INTEGER,
    paid_now INTEGER,
    to_bank INTEGER,
    bank_balance_after INTEGER
) AS $$
DECLARE
    v_monthly_base INTEGER;
    v_monthly_threshold INTEGER;
    v_retention INTEGER := 0;
    v_growth_bonus INTEGER := 0;
    v_total_bonus INTEGER;
    v_paid_now INTEGER;
    v_to_bank INTEGER;
    v_zone JSONB;
    v_zone_from INTEGER;
    v_zone_to INTEGER;
    v_taxable INTEGER;
BEGIN
    v_monthly_base := ROUND(p_config.annual_ebitda_base / 12.0);
    v_monthly_threshold := ROUND(v_monthly_base * (1 + p_config.kpi_growth_threshold_pct));

    IF p_ebitda IS NULL OR p_ebitda < 0 THEN
        RETURN QUERY SELECT
            v_monthly_base,
            v_monthly_threshold,
            0::INTEGER,
            0::INTEGER,
            0::INTEGER,
            0::INTEGER,
            0::INTEGER,
            p_prev_balance;
        RETURN;
    END IF;

    -- Retention
    IF p_ebitda < v_monthly_base THEN
        v_retention := 0;
    ELSIF p_ebitda <= v_monthly_threshold THEN
        v_retention := ROUND(
            p_config.retention_max::NUMERIC *
            (p_ebitda - v_monthly_base)::NUMERIC /
            NULLIF((v_monthly_threshold - v_monthly_base)::NUMERIC, 0)
        );
    ELSE
        v_retention := p_config.retention_max;
    END IF;

    -- Growth
    IF p_ebitda > v_monthly_threshold THEN
        IF p_config.tiered_growth_enabled AND jsonb_array_length(p_config.tiered_growth_json) > 0 THEN
            FOR v_zone IN SELECT * FROM jsonb_array_elements(p_config.tiered_growth_json)
            LOOP
                IF v_zone->>'from' = 'threshold' THEN
                    v_zone_from := v_monthly_threshold;
                ELSE
                    v_zone_from := (v_zone->>'from')::INTEGER;
                END IF;

                IF v_zone->>'to' IS NULL OR v_zone->>'to' = 'null' THEN
                    v_zone_to := 2147483647;
                ELSE
                    v_zone_to := (v_zone->>'to')::INTEGER;
                END IF;

                IF p_ebitda > v_zone_from THEN
                    v_taxable := LEAST(p_ebitda, v_zone_to) - v_zone_from;
                    IF v_taxable > 0 THEN
                        v_growth_bonus := v_growth_bonus + ROUND(v_taxable * (v_zone->>'rate')::NUMERIC);
                    END IF;
                END IF;
            END LOOP;
        ELSE
            v_growth_bonus := ROUND(p_config.growth_rate * (p_ebitda - v_monthly_threshold));
        END IF;
    END IF;

    v_total_bonus := v_retention + v_growth_bonus;
    v_paid_now := ROUND(v_total_bonus * (1 - p_config.bank_split_pct));
    v_to_bank := ROUND(v_total_bonus * p_config.bank_split_pct);

    RETURN QUERY SELECT
        v_monthly_base,
        v_monthly_threshold,
        v_retention,
        v_growth_bonus,
        v_total_bonus,
        v_paid_now,
        v_to_bank,
        p_prev_balance + v_to_bank;
END;
$$ LANGUAGE plpgsql;

-- Создание workspace
CREATE OR REPLACE FUNCTION create_workspace(p_name TEXT)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_config_id UUID;
BEGIN
    INSERT INTO workspaces (name, created_by)
    VALUES (p_name, auth.uid())
    RETURNING id INTO v_workspace_id;

    INSERT INTO memberships (workspace_id, user_id, role)
    VALUES (v_workspace_id, auth.uid(), 'admin');

    INSERT INTO configs (workspace_id, version, name, created_by)
    VALUES (v_workspace_id, 1, 'Начальная конфигурация', auth.uid())
    RETURNING id INTO v_config_id;

    INSERT INTO audit (workspace_id, entity_type, entity_id, action, new_values, user_id)
    VALUES (v_workspace_id, 'workspace', v_workspace_id, 'create',
            jsonb_build_object('name', p_name), auth.uid());

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object('workspace_id', v_workspace_id, 'config_id', v_config_id)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Инициализация года
CREATE OR REPLACE FUNCTION init_year(p_workspace_id UUID, p_year INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_config_id UUID;
    v_month INTEGER;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    IF EXISTS(SELECT 1 FROM years WHERE workspace_id = p_workspace_id AND year = p_year) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_EXISTS', 'message', 'Год уже инициализирован'));
    END IF;

    SELECT id INTO v_config_id FROM configs
    WHERE workspace_id = p_workspace_id ORDER BY version DESC LIMIT 1;

    IF v_config_id IS NULL THEN
        INSERT INTO configs (workspace_id, version, name, created_by)
        VALUES (p_workspace_id, 1, 'Начальная конфигурация', auth.uid())
        RETURNING id INTO v_config_id;
    END IF;

    INSERT INTO year_configs (workspace_id, year, config_id, effective_from_month)
    VALUES (p_workspace_id, p_year, v_config_id, 1)
    ON CONFLICT DO NOTHING;

    FOR v_month IN 1..12 LOOP
        INSERT INTO months (workspace_id, year, month, config_id)
        VALUES (p_workspace_id, p_year, v_month, v_config_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    FOR v_month IN 1..4 LOOP
        INSERT INTO quarters (workspace_id, year, quarter)
        VALUES (p_workspace_id, p_year, v_month)
        ON CONFLICT DO NOTHING;
    END LOOP;

    INSERT INTO years (workspace_id, year) VALUES (p_workspace_id, p_year)
    ON CONFLICT DO NOTHING;

    INSERT INTO ledger (workspace_id, year, operation_type, amount, balance_after, comment, created_by)
    VALUES (p_workspace_id, p_year, 'year_start', 0, 0, 'Начало года', auth.uid());

    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (p_workspace_id, 'year', 'init', jsonb_build_object('year', p_year), auth.uid());

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('year', p_year));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Пересчёт года
CREATE OR REPLACE FUNCTION recalculate_year(p_workspace_id UUID, p_year INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_month_rec RECORD;
    v_config configs;
    v_config_id UUID;
    v_prev_balance INTEGER := 0;
    v_calc RECORD;
    v_quarter INTEGER;
    v_quarter_ebitda INTEGER;
    v_quarter_to_bank INTEGER;
    v_quarter_threshold INTEGER;
    v_year_ebitda INTEGER := 0;
    v_year_total_bonus INTEGER := 0;
    v_year_paid_now INTEGER := 0;
    v_year_to_bank INTEGER := 0;
    v_year_closed BOOLEAN;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    SELECT closed INTO v_year_closed FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт, изменения запрещены'));
    END IF;

    FOR v_month_rec IN
        SELECT * FROM months
        WHERE workspace_id = p_workspace_id AND year = p_year
        ORDER BY month
    LOOP
        v_config_id := get_config_for_month(p_workspace_id, p_year, v_month_rec.month);
        IF v_config_id IS NULL THEN CONTINUE; END IF;

        SELECT * INTO v_config FROM configs WHERE id = v_config_id;
        SELECT * INTO v_calc FROM calculate_month_values(v_month_rec.ebitda, v_config, v_prev_balance);

        UPDATE months SET
            config_id = v_config_id,
            monthly_base = v_calc.monthly_base,
            monthly_threshold = v_calc.monthly_threshold,
            retention = v_calc.retention,
            growth_bonus = v_calc.growth_bonus,
            total_bonus = v_calc.total_bonus,
            paid_now = v_calc.paid_now,
            to_bank = v_calc.to_bank,
            bank_balance_after = v_calc.bank_balance_after
        WHERE id = v_month_rec.id;

        v_prev_balance := v_calc.bank_balance_after;

        IF v_month_rec.ebitda IS NOT NULL THEN
            v_year_ebitda := v_year_ebitda + v_month_rec.ebitda;
        END IF;
        v_year_total_bonus := v_year_total_bonus + v_calc.total_bonus;
        v_year_paid_now := v_year_paid_now + v_calc.paid_now;
        v_year_to_bank := v_year_to_bank + v_calc.to_bank;
    END LOOP;

    -- Кварталы
    FOR v_quarter IN 1..4 LOOP
        SELECT COALESCE(SUM(CASE WHEN ebitda IS NOT NULL THEN ebitda ELSE 0 END), 0),
               COALESCE(SUM(to_bank), 0)
        INTO v_quarter_ebitda, v_quarter_to_bank
        FROM months
        WHERE workspace_id = p_workspace_id AND year = p_year
          AND month BETWEEN (v_quarter - 1) * 3 + 1 AND v_quarter * 3;

        v_config_id := get_config_for_month(p_workspace_id, p_year, (v_quarter - 1) * 3 + 1);
        SELECT * INTO v_config FROM configs WHERE id = v_config_id;

        v_quarter_threshold := ROUND(v_config.annual_ebitda_base / 4.0 * (1 + v_config.quarterly_condition_pct));

        UPDATE quarters SET
            ebitda_sum = v_quarter_ebitda,
            to_bank_sum = v_quarter_to_bank,
            condition_threshold = v_quarter_threshold,
            condition_met = (v_quarter_ebitda >= v_quarter_threshold),
            payout_available = CASE
                WHEN v_config.quarter_payout_method = 'quarter_accrual'
                THEN ROUND(v_config.quarter_payout_pct * v_quarter_to_bank)
                ELSE ROUND(v_config.quarter_payout_pct * v_prev_balance)
            END
        WHERE workspace_id = p_workspace_id AND year = p_year AND quarter = v_quarter;
    END LOOP;

    -- Год
    v_config_id := get_config_for_month(p_workspace_id, p_year, 1);
    SELECT * INTO v_config FROM configs WHERE id = v_config_id;

    UPDATE years SET
        ebitda_sum = v_year_ebitda,
        total_bonus_sum = v_year_total_bonus,
        paid_now_sum = v_year_paid_now,
        to_bank_sum = v_year_to_bank,
        condition_threshold = ROUND(v_config.annual_ebitda_base * (1 + v_config.year_condition_pct)),
        condition_met = (v_year_ebitda >= ROUND(v_config.annual_ebitda_base * (1 + v_config.year_condition_pct)))
    WHERE workspace_id = p_workspace_id AND year = p_year;

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'year', p_year, 'ebitda_sum', v_year_ebitda, 'total_bonus_sum', v_year_total_bonus
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Обновление EBITDA месяца
CREATE OR REPLACE FUNCTION update_month_ebitda(
    p_workspace_id UUID,
    p_year INTEGER,
    p_month INTEGER,
    p_ebitda INTEGER,
    p_comment TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_month_id UUID;
    v_old_ebitda INTEGER;
    v_locked BOOLEAN;
    v_year_closed BOOLEAN;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    SELECT id, ebitda, locked INTO v_month_id, v_old_ebitda, v_locked
    FROM months WHERE workspace_id = p_workspace_id AND year = p_year AND month = p_month;

    IF v_month_id IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Месяц не найден'));
    END IF;

    IF v_locked THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'MONTH_LOCKED', 'message', 'Месяц заблокирован'));
    END IF;

    SELECT closed INTO v_year_closed FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт'));
    END IF;

    UPDATE months SET ebitda = p_ebitda, comment = COALESCE(p_comment, comment)
    WHERE id = v_month_id;

    INSERT INTO audit (workspace_id, entity_type, entity_id, action, old_values, new_values, user_id)
    VALUES (p_workspace_id, 'month', v_month_id, 'update_ebitda',
            jsonb_build_object('ebitda', v_old_ebitda),
            jsonb_build_object('ebitda', p_ebitda), auth.uid());

    RETURN recalculate_year(p_workspace_id, p_year);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Блокировка месяца
CREATE OR REPLACE FUNCTION toggle_month_lock(
    p_workspace_id UUID,
    p_year INTEGER,
    p_month INTEGER,
    p_locked BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
    v_month_id UUID;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    SELECT id INTO v_month_id FROM months
    WHERE workspace_id = p_workspace_id AND year = p_year AND month = p_month;

    IF v_month_id IS NULL THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Месяц не найден'));
    END IF;

    UPDATE months SET locked = p_locked WHERE id = v_month_id;

    INSERT INTO audit (workspace_id, entity_type, entity_id, action, new_values, user_id)
    VALUES (p_workspace_id, 'month', v_month_id,
            CASE WHEN p_locked THEN 'lock' ELSE 'unlock' END,
            jsonb_build_object('month', p_month, 'locked', p_locked), auth.uid());

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Квартальная выплата
CREATE OR REPLACE FUNCTION execute_quarter_payout(
    p_workspace_id UUID,
    p_year INTEGER,
    p_quarter INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_quarter_rec quarters;
    v_config configs;
    v_config_id UUID;
    v_payout_amount INTEGER;
    v_current_balance INTEGER;
    v_new_balance INTEGER;
    v_idempotency_key TEXT;
    v_all_filled BOOLEAN;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    v_idempotency_key := p_workspace_id::TEXT || ':' || p_year::TEXT || ':Q' || p_quarter::TEXT || ':payout';

    IF EXISTS (SELECT 1 FROM ledger WHERE workspace_id = p_workspace_id AND idempotency_key = v_idempotency_key) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'QUARTER_ALREADY_PAID',
                     'message', 'Выплата за Q' || p_quarter || ' ' || p_year || ' уже выполнена'));
    END IF;

    SELECT * INTO v_quarter_rec FROM quarters
    WHERE workspace_id = p_workspace_id AND year = p_year AND quarter = p_quarter;

    SELECT NOT EXISTS (
        SELECT 1 FROM months
        WHERE workspace_id = p_workspace_id AND year = p_year
          AND month BETWEEN (p_quarter - 1) * 3 + 1 AND p_quarter * 3
          AND ebitda IS NULL
    ) INTO v_all_filled;

    IF NOT v_all_filled THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'INCOMPLETE_DATA',
                     'message', 'Не все месяцы квартала заполнены'));
    END IF;

    IF NOT v_quarter_rec.condition_met THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'QUARTER_CONDITION_NOT_MET',
                     'message', 'Условие квартала не выполнено'));
    END IF;

    -- Баланс
    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year ORDER BY month DESC LIMIT 1), 0
    ) - COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout') AND amount < 0), 0
    ) + COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'), 0
    ) INTO v_current_balance;

    v_config_id := get_config_for_month(p_workspace_id, p_year, (p_quarter - 1) * 3 + 1);
    SELECT * INTO v_config FROM configs WHERE id = v_config_id;

    IF v_config.quarter_payout_method = 'quarter_accrual' THEN
        v_payout_amount := v_quarter_rec.payout_available;
    ELSE
        v_payout_amount := ROUND(v_config.quarter_payout_pct * v_current_balance);
    END IF;

    IF v_payout_amount > v_current_balance THEN
        v_payout_amount := v_current_balance;
    END IF;

    IF v_payout_amount <= 0 THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'INSUFFICIENT_BALANCE',
                     'message', 'Недостаточно средств'));
    END IF;

    v_new_balance := v_current_balance - v_payout_amount;

    INSERT INTO ledger (workspace_id, year, operation_type, quarter, amount, balance_after, comment, idempotency_key, created_by)
    VALUES (p_workspace_id, p_year, 'quarter_payout', p_quarter, -v_payout_amount, v_new_balance,
            'Квартальная выплата Q' || p_quarter, v_idempotency_key, auth.uid());

    UPDATE quarters SET payout_done = true
    WHERE workspace_id = p_workspace_id AND year = p_year AND quarter = p_quarter;

    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (p_workspace_id, 'ledger', 'quarter_payout',
            jsonb_build_object('quarter', p_quarter, 'amount', v_payout_amount), auth.uid());

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'quarter', p_quarter, 'amount', v_payout_amount, 'balance_after', v_new_balance
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Годовая выплата
CREATE OR REPLACE FUNCTION execute_year_payout(p_workspace_id UUID, p_year INTEGER)
RETURNS JSONB AS $$
DECLARE
    v_year_rec years;
    v_current_balance INTEGER;
    v_idempotency_key TEXT;
    v_all_filled BOOLEAN;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    v_idempotency_key := p_workspace_id::TEXT || ':' || p_year::TEXT || ':year_payout';

    IF EXISTS (SELECT 1 FROM ledger WHERE workspace_id = p_workspace_id AND idempotency_key = v_idempotency_key) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_ALREADY_PAID', 'message', 'Год уже закрыт'));
    END IF;

    SELECT * INTO v_year_rec FROM years WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_rec.closed THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год уже закрыт'));
    END IF;

    SELECT NOT EXISTS (SELECT 1 FROM months WHERE workspace_id = p_workspace_id AND year = p_year AND ebitda IS NULL)
    INTO v_all_filled;

    IF NOT v_all_filled THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'INCOMPLETE_DATA', 'message', 'Не все месяцы заполнены'));
    END IF;

    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year ORDER BY month DESC LIMIT 1), 0
    ) - COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout') AND amount < 0), 0
    ) + COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'), 0
    ) INTO v_current_balance;

    IF NOT v_year_rec.condition_met THEN
        INSERT INTO ledger (workspace_id, year, operation_type, amount, balance_after, comment, idempotency_key, created_by)
        VALUES (p_workspace_id, p_year, 'year_payout', -v_current_balance, 0,
                'Условие года не выполнено. Остаток сгорает.', v_idempotency_key, auth.uid());

        UPDATE years SET closed = true, closed_at = now()
        WHERE workspace_id = p_workspace_id AND year = p_year;
        UPDATE year_configs SET locked = true WHERE workspace_id = p_workspace_id AND year = p_year;

        RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
            'year', p_year, 'condition_met', false, 'burned', v_current_balance,
            'message', 'Условие не выполнено. Сгорело ' || v_current_balance || ' ₽'
        ));
    END IF;

    INSERT INTO ledger (workspace_id, year, operation_type, amount, balance_after, comment, idempotency_key, created_by)
    VALUES (p_workspace_id, p_year, 'year_payout', -v_current_balance, 0, 'Годовая выплата', v_idempotency_key, auth.uid());

    UPDATE years SET closed = true, closed_at = now() WHERE workspace_id = p_workspace_id AND year = p_year;
    UPDATE year_configs SET locked = true WHERE workspace_id = p_workspace_id AND year = p_year;
    UPDATE months SET locked = true WHERE workspace_id = p_workspace_id AND year = p_year;

    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (p_workspace_id, 'year', 'close_success', jsonb_build_object('payout', v_current_balance), auth.uid());

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'year', p_year, 'condition_met', true, 'amount', v_current_balance,
        'message', 'Год закрыт. Выплачено ' || v_current_balance || ' ₽'
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ручная корректировка
CREATE OR REPLACE FUNCTION adjust_bank(
    p_workspace_id UUID,
    p_year INTEGER,
    p_amount INTEGER,
    p_comment TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
    v_year_closed BOOLEAN;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    IF p_comment IS NULL OR trim(p_comment) = '' THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'COMMENT_REQUIRED', 'message', 'Комментарий обязателен'));
    END IF;

    SELECT closed INTO v_year_closed FROM years WHERE workspace_id = p_workspace_id AND year = p_year;
    IF v_year_closed THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт'));
    END IF;

    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year ORDER BY month DESC LIMIT 1), 0
    ) - COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout') AND amount < 0), 0
    ) + COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'), 0
    ) INTO v_current_balance;

    v_new_balance := v_current_balance + p_amount;

    IF v_new_balance < 0 THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'INVALID_AMOUNT', 'message', 'Отрицательный баланс'));
    END IF;

    INSERT INTO ledger (workspace_id, year, operation_type, amount, balance_after, comment, created_by)
    VALUES (p_workspace_id, p_year, 'manual_adjustment', p_amount, v_new_balance, p_comment, auth.uid());

    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (p_workspace_id, 'ledger', 'manual_adjustment',
            jsonb_build_object('amount', p_amount, 'comment', p_comment), auth.uid());

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'amount', p_amount, 'balance_after', v_new_balance
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Создание версии конфигурации
CREATE OR REPLACE FUNCTION create_config_version(
    p_workspace_id UUID,
    p_name TEXT,
    p_fixed_monthly INTEGER,
    p_annual_ebitda_base INTEGER,
    p_kpi_growth_threshold_pct NUMERIC,
    p_retention_max INTEGER,
    p_growth_rate NUMERIC,
    p_bank_split_pct NUMERIC,
    p_quarter_payout_pct NUMERIC,
    p_quarterly_condition_pct NUMERIC,
    p_year_condition_pct NUMERIC,
    p_tiered_growth_enabled BOOLEAN,
    p_tiered_growth_json JSONB,
    p_quarter_payout_method TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_new_version INTEGER;
    v_config_id UUID;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version FROM configs WHERE workspace_id = p_workspace_id;

    INSERT INTO configs (
        workspace_id, version, name, fixed_monthly, annual_ebitda_base, kpi_growth_threshold_pct,
        retention_max, growth_rate, bank_split_pct, quarter_payout_pct, quarterly_condition_pct,
        year_condition_pct, tiered_growth_enabled, tiered_growth_json, quarter_payout_method, created_by
    ) VALUES (
        p_workspace_id, v_new_version, p_name, p_fixed_monthly, p_annual_ebitda_base, p_kpi_growth_threshold_pct,
        p_retention_max, p_growth_rate, p_bank_split_pct, p_quarter_payout_pct, p_quarterly_condition_pct,
        p_year_condition_pct, p_tiered_growth_enabled, p_tiered_growth_json, p_quarter_payout_method, auth.uid()
    ) RETURNING id INTO v_config_id;

    INSERT INTO audit (workspace_id, entity_type, entity_id, action, new_values, user_id)
    VALUES (p_workspace_id, 'config', v_config_id, 'create',
            jsonb_build_object('version', v_new_version, 'name', p_name), auth.uid());

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_config_id, 'version', v_new_version));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Назначение конфигурации году
CREATE OR REPLACE FUNCTION assign_config_to_year(
    p_workspace_id UUID,
    p_year INTEGER,
    p_config_id UUID,
    p_effective_from_month INTEGER DEFAULT 1
)
RETURNS JSONB AS $$
DECLARE
    v_year_closed BOOLEAN;
BEGIN
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён'));
    END IF;

    SELECT closed INTO v_year_closed FROM years WHERE workspace_id = p_workspace_id AND year = p_year;
    IF v_year_closed THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт'));
    END IF;

    INSERT INTO year_configs (workspace_id, year, config_id, effective_from_month)
    VALUES (p_workspace_id, p_year, p_config_id, p_effective_from_month)
    ON CONFLICT (workspace_id, year, effective_from_month)
    DO UPDATE SET config_id = p_config_id, updated_at = now();

    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (p_workspace_id, 'year_config', 'assign',
            jsonb_build_object('year', p_year, 'config_id', p_config_id, 'month', p_effective_from_month), auth.uid());

    RETURN recalculate_year(p_workspace_id, p_year);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
