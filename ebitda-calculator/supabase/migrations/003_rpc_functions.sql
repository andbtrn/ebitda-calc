-- =====================================================
-- Калькулятор мотивации по EBITDA
-- Миграция 003: RPC функции
-- =====================================================

-- =====================================================
-- ФУНКЦИЯ: Получить активную конфигурацию для месяца
-- =====================================================
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

-- =====================================================
-- ФУНКЦИЯ: Инициализация года
-- =====================================================
CREATE OR REPLACE FUNCTION init_year(
    p_workspace_id UUID,
    p_year INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_config_id UUID;
    v_month INTEGER;
    v_year_exists BOOLEAN;
BEGIN
    -- Проверяем права доступа
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Проверяем, существует ли год
    SELECT EXISTS(SELECT 1 FROM years WHERE workspace_id = p_workspace_id AND year = p_year)
    INTO v_year_exists;

    IF v_year_exists THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_EXISTS', 'message', 'Год уже инициализирован')
        );
    END IF;

    -- Получаем последнюю конфигурацию или создаём дефолтную
    SELECT id INTO v_config_id
    FROM configs
    WHERE workspace_id = p_workspace_id
    ORDER BY version DESC
    LIMIT 1;

    IF v_config_id IS NULL THEN
        INSERT INTO configs (workspace_id, version, name, created_by)
        VALUES (p_workspace_id, 1, 'Начальная конфигурация', auth.uid())
        RETURNING id INTO v_config_id;
    END IF;

    -- Создаём привязку конфигурации к году
    INSERT INTO year_configs (workspace_id, year, config_id, effective_from_month)
    VALUES (p_workspace_id, p_year, v_config_id, 1)
    ON CONFLICT (workspace_id, year, effective_from_month) DO NOTHING;

    -- Создаём 12 месяцев
    FOR v_month IN 1..12 LOOP
        INSERT INTO months (workspace_id, year, month, config_id)
        VALUES (p_workspace_id, p_year, v_month, v_config_id)
        ON CONFLICT (workspace_id, year, month) DO NOTHING;
    END LOOP;

    -- Создаём 4 квартала
    FOR v_month IN 1..4 LOOP
        INSERT INTO quarters (workspace_id, year, quarter)
        VALUES (p_workspace_id, p_year, v_month)
        ON CONFLICT (workspace_id, year, quarter) DO NOTHING;
    END LOOP;

    -- Создаём запись года
    INSERT INTO years (workspace_id, year)
    VALUES (p_workspace_id, p_year)
    ON CONFLICT (workspace_id, year) DO NOTHING;

    -- Создаём начальную запись в ledger
    INSERT INTO ledger (workspace_id, year, operation_type, amount, balance_after, comment, created_by)
    VALUES (p_workspace_id, p_year, 'year_start', 0, 0, 'Начало года', auth.uid());

    -- Запись в аудит
    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (
        p_workspace_id,
        'year',
        'init',
        jsonb_build_object('year', p_year),
        auth.uid()
    );

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object('year', p_year));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Расчёт одного месяца
-- =====================================================
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
    -- Базовые значения
    v_monthly_base := ROUND(p_config.annual_ebitda_base / 12.0);
    v_monthly_threshold := ROUND(v_monthly_base * (1 + p_config.kpi_growth_threshold_pct));

    -- Если EBITDA не введена или отрицательная
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

    -- Расчёт удержания (retention)
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

    -- Расчёт роста (growth_bonus)
    IF p_ebitda > v_monthly_threshold THEN
        IF p_config.tiered_growth_enabled AND jsonb_array_length(p_config.tiered_growth_json) > 0 THEN
            -- Градационный режим
            FOR v_zone IN SELECT * FROM jsonb_array_elements(p_config.tiered_growth_json)
            LOOP
                -- Определяем границы зоны
                IF v_zone->>'from' = 'threshold' THEN
                    v_zone_from := v_monthly_threshold;
                ELSE
                    v_zone_from := (v_zone->>'from')::INTEGER;
                END IF;

                IF v_zone->>'to' IS NULL OR v_zone->>'to' = 'null' THEN
                    v_zone_to := 2147483647; -- max int
                ELSE
                    v_zone_to := (v_zone->>'to')::INTEGER;
                END IF;

                -- Рассчитываем налогооблагаемую часть в этой зоне
                IF p_ebitda > v_zone_from THEN
                    v_taxable := LEAST(p_ebitda, v_zone_to) - v_zone_from;
                    IF v_taxable > 0 THEN
                        v_growth_bonus := v_growth_bonus + ROUND(v_taxable * (v_zone->>'rate')::NUMERIC);
                    END IF;
                END IF;
            END LOOP;
        ELSE
            -- Обычный режим
            v_growth_bonus := ROUND(p_config.growth_rate * (p_ebitda - v_monthly_threshold));
        END IF;
    END IF;

    -- Итого
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

-- =====================================================
-- ФУНКЦИЯ: Пересчёт года
-- =====================================================
CREATE OR REPLACE FUNCTION recalculate_year(
    p_workspace_id UUID,
    p_year INTEGER
)
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
    v_payouts_sum INTEGER;
    v_year_closed BOOLEAN;
BEGIN
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Проверяем, не закрыт ли год
    SELECT closed INTO v_year_closed
    FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт, изменения запрещены')
        );
    END IF;

    -- Получаем сумму всех выплат за год (кроме начислений)
    SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)
    INTO v_payouts_sum
    FROM ledger
    WHERE workspace_id = p_workspace_id
      AND year = p_year
      AND operation_type IN ('quarter_payout', 'year_payout', 'manual_adjustment');

    -- Пересчитываем каждый месяц
    FOR v_month_rec IN
        SELECT m.*, m.ebitda as input_ebitda
        FROM months m
        WHERE m.workspace_id = p_workspace_id AND m.year = p_year
        ORDER BY m.month
    LOOP
        -- Получаем конфигурацию для месяца
        v_config_id := get_config_for_month(p_workspace_id, p_year, v_month_rec.month);

        IF v_config_id IS NULL THEN
            CONTINUE;
        END IF;

        SELECT * INTO v_config FROM configs WHERE id = v_config_id;

        -- Рассчитываем значения
        SELECT * INTO v_calc
        FROM calculate_month_values(v_month_rec.input_ebitda, v_config, v_prev_balance);

        -- Обновляем месяц
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

        -- Обновляем running balance
        v_prev_balance := v_calc.bank_balance_after;

        -- Накапливаем годовые суммы
        IF v_month_rec.input_ebitda IS NOT NULL THEN
            v_year_ebitda := v_year_ebitda + v_month_rec.input_ebitda;
        END IF;
        v_year_total_bonus := v_year_total_bonus + v_calc.total_bonus;
        v_year_paid_now := v_year_paid_now + v_calc.paid_now;
        v_year_to_bank := v_year_to_bank + v_calc.to_bank;
    END LOOP;

    -- Пересчитываем кварталы
    FOR v_quarter IN 1..4 LOOP
        SELECT
            COALESCE(SUM(CASE WHEN ebitda IS NOT NULL THEN ebitda ELSE 0 END), 0),
            COALESCE(SUM(to_bank), 0)
        INTO v_quarter_ebitda, v_quarter_to_bank
        FROM months
        WHERE workspace_id = p_workspace_id
          AND year = p_year
          AND month BETWEEN (v_quarter - 1) * 3 + 1 AND v_quarter * 3;

        -- Получаем конфигурацию для расчёта порога
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
        WHERE workspace_id = p_workspace_id
          AND year = p_year
          AND quarter = v_quarter;
    END LOOP;

    -- Обновляем год
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

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'year', p_year,
            'ebitda_sum', v_year_ebitda,
            'total_bonus_sum', v_year_total_bonus,
            'bank_balance', v_prev_balance - v_payouts_sum
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Обновление EBITDA месяца
-- =====================================================
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
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Получаем текущее состояние
    SELECT id, ebitda, locked INTO v_month_id, v_old_ebitda, v_locked
    FROM months
    WHERE workspace_id = p_workspace_id AND year = p_year AND month = p_month;

    IF v_month_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Месяц не найден')
        );
    END IF;

    -- Проверяем блокировку месяца
    IF v_locked THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'MONTH_LOCKED', 'message', 'Месяц заблокирован для редактирования')
        );
    END IF;

    -- Проверяем закрытие года
    SELECT closed INTO v_year_closed
    FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт, изменения запрещены')
        );
    END IF;

    -- Обновляем EBITDA
    UPDATE months SET
        ebitda = p_ebitda,
        comment = COALESCE(p_comment, comment)
    WHERE id = v_month_id;

    -- Запись в аудит
    INSERT INTO audit (workspace_id, entity_type, entity_id, action, old_values, new_values, user_id)
    VALUES (
        p_workspace_id,
        'month',
        v_month_id,
        'update_ebitda',
        jsonb_build_object('ebitda', v_old_ebitda),
        jsonb_build_object('ebitda', p_ebitda, 'comment', p_comment),
        auth.uid()
    );

    -- Пересчитываем год
    RETURN recalculate_year(p_workspace_id, p_year);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Блокировка/разблокировка месяца
-- =====================================================
CREATE OR REPLACE FUNCTION toggle_month_lock(
    p_workspace_id UUID,
    p_year INTEGER,
    p_month INTEGER,
    p_locked BOOLEAN
)
RETURNS JSONB AS $$
DECLARE
    v_month_id UUID;
    v_year_closed BOOLEAN;
BEGIN
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Проверяем закрытие года
    SELECT closed INTO v_year_closed
    FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт')
        );
    END IF;

    -- Получаем месяц
    SELECT id INTO v_month_id
    FROM months
    WHERE workspace_id = p_workspace_id AND year = p_year AND month = p_month;

    IF v_month_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Месяц не найден')
        );
    END IF;

    -- Обновляем статус блокировки
    UPDATE months SET locked = p_locked WHERE id = v_month_id;

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, entity_id, action, new_values, user_id)
    VALUES (
        p_workspace_id,
        'month',
        v_month_id,
        CASE WHEN p_locked THEN 'lock' ELSE 'unlock' END,
        jsonb_build_object('month', p_month, 'locked', p_locked),
        auth.uid()
    );

    RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Квартальная выплата
-- =====================================================
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
    v_all_months_filled BOOLEAN;
BEGIN
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Формируем ключ идемпотентности
    v_idempotency_key := p_workspace_id::TEXT || ':' || p_year::TEXT || ':Q' || p_quarter::TEXT || ':payout';

    -- Проверяем, не выполнена ли уже выплата
    IF EXISTS (SELECT 1 FROM ledger WHERE workspace_id = p_workspace_id AND idempotency_key = v_idempotency_key) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'QUARTER_ALREADY_PAID', 'message', 'Выплата за Q' || p_quarter || ' ' || p_year || ' уже выполнена')
        );
    END IF;

    -- Получаем данные квартала
    SELECT * INTO v_quarter_rec
    FROM quarters
    WHERE workspace_id = p_workspace_id AND year = p_year AND quarter = p_quarter;

    IF v_quarter_rec IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Квартал не найден')
        );
    END IF;

    -- Проверяем, все ли месяцы квартала заполнены
    SELECT NOT EXISTS (
        SELECT 1 FROM months
        WHERE workspace_id = p_workspace_id
          AND year = p_year
          AND month BETWEEN (p_quarter - 1) * 3 + 1 AND p_quarter * 3
          AND ebitda IS NULL
    ) INTO v_all_months_filled;

    IF NOT v_all_months_filled THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'INCOMPLETE_DATA', 'message', 'Не все месяцы квартала заполнены')
        );
    END IF;

    -- Проверяем условие квартала
    IF NOT v_quarter_rec.condition_met THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object(
                'code', 'QUARTER_CONDITION_NOT_MET',
                'message', 'Условие квартала не выполнено. EBITDA: ' || v_quarter_rec.ebitda_sum || ' ₽, порог: ' || v_quarter_rec.condition_threshold || ' ₽'
            )
        );
    END IF;

    -- Получаем текущий баланс банка
    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year
         ORDER BY month DESC LIMIT 1),
        0
    ) -
    COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout')
           AND amount < 0),
        0
    ) +
    COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'),
        0
    )
    INTO v_current_balance;

    -- Определяем сумму выплаты
    v_config_id := get_config_for_month(p_workspace_id, p_year, (p_quarter - 1) * 3 + 1);
    SELECT * INTO v_config FROM configs WHERE id = v_config_id;

    IF v_config.quarter_payout_method = 'quarter_accrual' THEN
        v_payout_amount := v_quarter_rec.payout_available;
    ELSE
        v_payout_amount := ROUND(v_config.quarter_payout_pct * v_current_balance);
    END IF;

    -- Проверяем, достаточно ли средств
    IF v_payout_amount > v_current_balance THEN
        v_payout_amount := v_current_balance;
    END IF;

    IF v_payout_amount <= 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'INSUFFICIENT_BALANCE', 'message', 'Недостаточно средств в банке')
        );
    END IF;

    v_new_balance := v_current_balance - v_payout_amount;

    -- Создаём запись в ledger
    INSERT INTO ledger (
        workspace_id, year, operation_type, quarter, amount, balance_after,
        comment, idempotency_key, created_by
    ) VALUES (
        p_workspace_id, p_year, 'quarter_payout', p_quarter, -v_payout_amount, v_new_balance,
        'Квартальная выплата Q' || p_quarter, v_idempotency_key, auth.uid()
    );

    -- Помечаем квартал как выплаченный
    UPDATE quarters SET payout_done = true
    WHERE workspace_id = p_workspace_id AND year = p_year AND quarter = p_quarter;

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (
        p_workspace_id,
        'ledger',
        'quarter_payout',
        jsonb_build_object('quarter', p_quarter, 'amount', v_payout_amount, 'balance_after', v_new_balance),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'quarter', p_quarter,
            'amount', v_payout_amount,
            'balance_after', v_new_balance
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Годовая выплата и закрытие года
-- =====================================================
CREATE OR REPLACE FUNCTION execute_year_payout(
    p_workspace_id UUID,
    p_year INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_year_rec years;
    v_current_balance INTEGER;
    v_new_balance INTEGER := 0;
    v_idempotency_key TEXT;
    v_all_months_filled BOOLEAN;
BEGIN
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Формируем ключ идемпотентности
    v_idempotency_key := p_workspace_id::TEXT || ':' || p_year::TEXT || ':year_payout';

    -- Проверяем, не выполнена ли уже выплата
    IF EXISTS (SELECT 1 FROM ledger WHERE workspace_id = p_workspace_id AND idempotency_key = v_idempotency_key) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_ALREADY_PAID', 'message', 'Год ' || p_year || ' уже закрыт')
        );
    END IF;

    -- Получаем данные года
    SELECT * INTO v_year_rec
    FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_rec IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Год не найден')
        );
    END IF;

    IF v_year_rec.closed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год уже закрыт')
        );
    END IF;

    -- Проверяем, все ли месяцы заполнены
    SELECT NOT EXISTS (
        SELECT 1 FROM months
        WHERE workspace_id = p_workspace_id AND year = p_year AND ebitda IS NULL
    ) INTO v_all_months_filled;

    IF NOT v_all_months_filled THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'INCOMPLETE_DATA', 'message', 'Не все месяцы года заполнены')
        );
    END IF;

    -- Получаем текущий баланс
    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year
         ORDER BY month DESC LIMIT 1),
        0
    ) -
    COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout')
           AND amount < 0),
        0
    ) +
    COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'),
        0
    )
    INTO v_current_balance;

    -- Проверяем условие года
    IF NOT v_year_rec.condition_met THEN
        -- Условие не выполнено - остаток сгорает
        INSERT INTO ledger (
            workspace_id, year, operation_type, amount, balance_after,
            comment, idempotency_key, created_by
        ) VALUES (
            p_workspace_id, p_year, 'year_payout', -v_current_balance, 0,
            'Условие года не выполнено. Остаток сгорает.', v_idempotency_key, auth.uid()
        );

        -- Закрываем год
        UPDATE years SET closed = true, closed_at = now()
        WHERE workspace_id = p_workspace_id AND year = p_year;

        -- Блокируем конфигурации года
        UPDATE year_configs SET locked = true
        WHERE workspace_id = p_workspace_id AND year = p_year;

        -- Аудит
        INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
        VALUES (
            p_workspace_id,
            'year',
            'close_failed',
            jsonb_build_object('year', p_year, 'burned', v_current_balance),
            auth.uid()
        );

        RETURN jsonb_build_object(
            'success', true,
            'data', jsonb_build_object(
                'year', p_year,
                'condition_met', false,
                'burned', v_current_balance,
                'message', 'Условие года не выполнено. Остаток ' || v_current_balance || ' ₽ сгорает.'
            )
        );
    END IF;

    -- Условие выполнено - выплачиваем остаток
    INSERT INTO ledger (
        workspace_id, year, operation_type, amount, balance_after,
        comment, idempotency_key, created_by
    ) VALUES (
        p_workspace_id, p_year, 'year_payout', -v_current_balance, 0,
        'Годовая выплата', v_idempotency_key, auth.uid()
    );

    -- Закрываем год
    UPDATE years SET closed = true, closed_at = now()
    WHERE workspace_id = p_workspace_id AND year = p_year;

    -- Блокируем конфигурации года
    UPDATE year_configs SET locked = true
    WHERE workspace_id = p_workspace_id AND year = p_year;

    -- Блокируем все месяцы
    UPDATE months SET locked = true
    WHERE workspace_id = p_workspace_id AND year = p_year;

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (
        p_workspace_id,
        'year',
        'close_success',
        jsonb_build_object('year', p_year, 'payout', v_current_balance),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'year', p_year,
            'condition_met', true,
            'amount', v_current_balance,
            'message', 'Год закрыт. Выплачено ' || v_current_balance || ' ₽'
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Ручная корректировка банка
-- =====================================================
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
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Проверяем комментарий
    IF p_comment IS NULL OR trim(p_comment) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'COMMENT_REQUIRED', 'message', 'Комментарий обязателен для корректировки')
        );
    END IF;

    -- Проверяем закрытие года
    SELECT closed INTO v_year_closed
    FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт')
        );
    END IF;

    -- Получаем текущий баланс
    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year
         ORDER BY month DESC LIMIT 1),
        0
    ) -
    COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout')
           AND amount < 0),
        0
    ) +
    COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'),
        0
    )
    INTO v_current_balance;

    v_new_balance := v_current_balance + p_amount;

    -- Проверяем, не уходим ли в минус
    IF v_new_balance < 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'INVALID_AMOUNT', 'message', 'Корректировка приведёт к отрицательному балансу')
        );
    END IF;

    -- Создаём запись в ledger
    INSERT INTO ledger (
        workspace_id, year, operation_type, amount, balance_after,
        comment, created_by
    ) VALUES (
        p_workspace_id, p_year, 'manual_adjustment', p_amount, v_new_balance,
        p_comment, auth.uid()
    );

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (
        p_workspace_id,
        'ledger',
        'manual_adjustment',
        jsonb_build_object('amount', p_amount, 'comment', p_comment, 'balance_after', v_new_balance),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'amount', p_amount,
            'balance_after', v_new_balance
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Создание новой версии конфигурации
-- =====================================================
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
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Получаем следующую версию
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_new_version
    FROM configs
    WHERE workspace_id = p_workspace_id;

    -- Создаём конфигурацию
    INSERT INTO configs (
        workspace_id, version, name,
        fixed_monthly, annual_ebitda_base, kpi_growth_threshold_pct,
        retention_max, growth_rate, bank_split_pct,
        quarter_payout_pct, quarterly_condition_pct, year_condition_pct,
        tiered_growth_enabled, tiered_growth_json, quarter_payout_method,
        created_by
    ) VALUES (
        p_workspace_id, v_new_version, p_name,
        p_fixed_monthly, p_annual_ebitda_base, p_kpi_growth_threshold_pct,
        p_retention_max, p_growth_rate, p_bank_split_pct,
        p_quarter_payout_pct, p_quarterly_condition_pct, p_year_condition_pct,
        p_tiered_growth_enabled, p_tiered_growth_json, p_quarter_payout_method,
        auth.uid()
    )
    RETURNING id INTO v_config_id;

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, entity_id, action, new_values, user_id)
    VALUES (
        p_workspace_id,
        'config',
        v_config_id,
        'create',
        jsonb_build_object('version', v_new_version, 'name', p_name),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'id', v_config_id,
            'version', v_new_version
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Назначение конфигурации году
-- =====================================================
CREATE OR REPLACE FUNCTION assign_config_to_year(
    p_workspace_id UUID,
    p_year INTEGER,
    p_config_id UUID,
    p_effective_from_month INTEGER DEFAULT 1
)
RETURNS JSONB AS $$
DECLARE
    v_year_closed BOOLEAN;
    v_old_config_id UUID;
BEGIN
    -- Проверяем права
    IF NOT is_workspace_admin(p_workspace_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'ACCESS_DENIED', 'message', 'Доступ запрещён')
        );
    END IF;

    -- Проверяем закрытие года
    SELECT closed INTO v_year_closed
    FROM years
    WHERE workspace_id = p_workspace_id AND year = p_year;

    IF v_year_closed THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', jsonb_build_object('code', 'YEAR_CLOSED', 'message', 'Год закрыт, смена конфигурации запрещена')
        );
    END IF;

    -- Получаем старую конфигурацию
    SELECT config_id INTO v_old_config_id
    FROM year_configs
    WHERE workspace_id = p_workspace_id AND year = p_year AND effective_from_month = p_effective_from_month;

    -- Создаём или обновляем привязку
    INSERT INTO year_configs (workspace_id, year, config_id, effective_from_month)
    VALUES (p_workspace_id, p_year, p_config_id, p_effective_from_month)
    ON CONFLICT (workspace_id, year, effective_from_month)
    DO UPDATE SET config_id = p_config_id, updated_at = now();

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, action, old_values, new_values, user_id)
    VALUES (
        p_workspace_id,
        'year_config',
        'assign',
        jsonb_build_object('config_id', v_old_config_id),
        jsonb_build_object('year', p_year, 'config_id', p_config_id, 'effective_from_month', p_effective_from_month),
        auth.uid()
    );

    -- Пересчитываем год
    RETURN recalculate_year(p_workspace_id, p_year);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Создание workspace с начальной конфигурацией
-- =====================================================
CREATE OR REPLACE FUNCTION create_workspace(
    p_name TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_workspace_id UUID;
    v_config_id UUID;
BEGIN
    -- Создаём workspace
    INSERT INTO workspaces (name, created_by)
    VALUES (p_name, auth.uid())
    RETURNING id INTO v_workspace_id;

    -- Создаём membership
    INSERT INTO memberships (workspace_id, user_id, role)
    VALUES (v_workspace_id, auth.uid(), 'admin');

    -- Создаём начальную конфигурацию
    INSERT INTO configs (workspace_id, version, name, created_by)
    VALUES (v_workspace_id, 1, 'Начальная конфигурация', auth.uid())
    RETURNING id INTO v_config_id;

    -- Аудит
    INSERT INTO audit (workspace_id, entity_type, entity_id, action, new_values, user_id)
    VALUES (
        v_workspace_id,
        'workspace',
        v_workspace_id,
        'create',
        jsonb_build_object('name', p_name),
        auth.uid()
    );

    RETURN jsonb_build_object(
        'success', true,
        'data', jsonb_build_object(
            'workspace_id', v_workspace_id,
            'config_id', v_config_id
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ФУНКЦИЯ: Получение текущего баланса банка
-- =====================================================
CREATE OR REPLACE FUNCTION get_bank_balance(
    p_workspace_id UUID,
    p_year INTEGER
)
RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT COALESCE(
        (SELECT bank_balance_after FROM months
         WHERE workspace_id = p_workspace_id AND year = p_year
         ORDER BY month DESC LIMIT 1),
        0
    ) -
    COALESCE(
        (SELECT SUM(ABS(amount)) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type IN ('quarter_payout', 'year_payout')
           AND amount < 0),
        0
    ) +
    COALESCE(
        (SELECT SUM(amount) FROM ledger
         WHERE workspace_id = p_workspace_id AND year = p_year
           AND operation_type = 'manual_adjustment'),
        0
    )
    INTO v_balance;

    RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
