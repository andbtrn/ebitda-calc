-- Обновление функции execute_quarter_payout для поддержки кастомной суммы и комментария
CREATE OR REPLACE FUNCTION execute_quarter_payout(
    p_workspace_id UUID,
    p_year INTEGER,
    p_quarter INTEGER,
    p_custom_amount INTEGER DEFAULT NULL,
    p_comment TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_quarter_rec quarters;
    v_config configs;
    v_config_id UUID;
    v_payout_amount INTEGER;
    v_max_payout_amount INTEGER;
    v_current_balance INTEGER;
    v_new_balance INTEGER;
    v_idempotency_key TEXT;
    v_all_filled BOOLEAN;
    v_final_comment TEXT;
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

    -- Рассчитываем максимальную сумму выплаты
    IF v_config.quarter_payout_method = 'quarter_accrual' THEN
        v_max_payout_amount := v_quarter_rec.payout_available;
    ELSE
        v_max_payout_amount := ROUND(v_config.quarter_payout_pct * v_current_balance);
    END IF;

    IF v_max_payout_amount > v_current_balance THEN
        v_max_payout_amount := v_current_balance;
    END IF;

    -- Используем кастомную сумму, если указана
    IF p_custom_amount IS NOT NULL THEN
        IF p_custom_amount > v_max_payout_amount THEN
            RETURN jsonb_build_object('success', false,
                'error', jsonb_build_object('code', 'AMOUNT_EXCEEDS_MAX',
                         'message', 'Сумма не может превышать ' || v_max_payout_amount));
        END IF;
        IF p_custom_amount <= 0 THEN
            RETURN jsonb_build_object('success', false,
                'error', jsonb_build_object('code', 'INVALID_AMOUNT',
                         'message', 'Сумма должна быть больше нуля'));
        END IF;
        v_payout_amount := p_custom_amount;
    ELSE
        v_payout_amount := v_max_payout_amount;
    END IF;

    IF v_payout_amount <= 0 THEN
        RETURN jsonb_build_object('success', false,
            'error', jsonb_build_object('code', 'INSUFFICIENT_BALANCE',
                     'message', 'Недостаточно средств'));
    END IF;

    v_new_balance := v_current_balance - v_payout_amount;

    -- Формируем комментарий
    IF p_comment IS NOT NULL AND p_comment != '' THEN
        v_final_comment := 'Квартальная выплата Q' || p_quarter || ': ' || p_comment;
    ELSE
        v_final_comment := 'Квартальная выплата Q' || p_quarter;
    END IF;

    INSERT INTO ledger (workspace_id, year, operation_type, quarter, amount, balance_after, comment, idempotency_key, created_by)
    VALUES (p_workspace_id, p_year, 'quarter_payout', p_quarter, -v_payout_amount, v_new_balance,
            v_final_comment, v_idempotency_key, auth.uid());

    UPDATE quarters SET payout_done = true
    WHERE workspace_id = p_workspace_id AND year = p_year AND quarter = p_quarter;

    INSERT INTO audit (workspace_id, entity_type, action, new_values, user_id)
    VALUES (p_workspace_id, 'ledger', 'quarter_payout',
            jsonb_build_object('quarter', p_quarter, 'amount', v_payout_amount, 'custom_amount', p_custom_amount, 'comment', p_comment), auth.uid());

    RETURN jsonb_build_object('success', true, 'data', jsonb_build_object(
        'quarter', p_quarter, 'amount', v_payout_amount, 'balance_after', v_new_balance
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
