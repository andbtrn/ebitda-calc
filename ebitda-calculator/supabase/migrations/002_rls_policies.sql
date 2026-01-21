-- =====================================================
-- Калькулятор мотивации по EBITDA
-- Миграция 002: RLS политики
-- =====================================================

-- Включаем RLS для всех таблиц
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE year_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE months ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarters ENABLE ROW LEVEL SECURITY;
ALTER TABLE years ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Вспомогательная функция: проверка членства
-- =====================================================
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

-- =====================================================
-- ПОЛИТИКИ: workspaces
-- =====================================================
CREATE POLICY "Пользователи видят свои workspace"
    ON workspaces FOR SELECT
    USING (is_workspace_member(id));

CREATE POLICY "Пользователи могут создавать workspace"
    ON workspaces FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Админы могут обновлять workspace"
    ON workspaces FOR UPDATE
    USING (is_workspace_admin(id));

-- =====================================================
-- ПОЛИТИКИ: memberships
-- =====================================================
CREATE POLICY "Участники видят членство в своих workspace"
    ON memberships FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Система создаёт членство"
    ON memberships FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Админы управляют членством"
    ON memberships FOR UPDATE
    USING (is_workspace_admin(workspace_id));

CREATE POLICY "Админы удаляют членство"
    ON memberships FOR DELETE
    USING (is_workspace_admin(workspace_id));

-- =====================================================
-- ПОЛИТИКИ: configs
-- =====================================================
CREATE POLICY "Участники видят конфигурации"
    ON configs FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Админы создают конфигурации"
    ON configs FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

-- Конфигурации не обновляются (создаётся новая версия)

-- =====================================================
-- ПОЛИТИКИ: year_configs
-- =====================================================
CREATE POLICY "Участники видят year_configs"
    ON year_configs FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Админы управляют year_configs"
    ON year_configs FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Админы обновляют year_configs (если не locked)"
    ON year_configs FOR UPDATE
    USING (is_workspace_admin(workspace_id) AND NOT locked);

-- =====================================================
-- ПОЛИТИКИ: months
-- =====================================================
CREATE POLICY "Участники видят месяцы"
    ON months FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Админы создают месяцы"
    ON months FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Админы обновляют незаблокированные месяцы"
    ON months FOR UPDATE
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

-- =====================================================
-- ПОЛИТИКИ: quarters
-- =====================================================
CREATE POLICY "Участники видят кварталы"
    ON quarters FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Система управляет кварталами"
    ON quarters FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Система обновляет кварталы"
    ON quarters FOR UPDATE
    USING (is_workspace_admin(workspace_id));

-- =====================================================
-- ПОЛИТИКИ: years
-- =====================================================
CREATE POLICY "Участники видят годы"
    ON years FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Система управляет годами"
    ON years FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Система обновляет годы"
    ON years FOR UPDATE
    USING (is_workspace_admin(workspace_id));

-- =====================================================
-- ПОЛИТИКИ: ledger
-- =====================================================
CREATE POLICY "Участники видят ledger"
    ON ledger FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Система создаёт записи ledger"
    ON ledger FOR INSERT
    WITH CHECK (is_workspace_admin(workspace_id));

-- ledger не обновляется и не удаляется (append-only)

-- =====================================================
-- ПОЛИТИКИ: audit
-- =====================================================
CREATE POLICY "Участники видят аудит"
    ON audit FOR SELECT
    USING (is_workspace_member(workspace_id));

CREATE POLICY "Система создаёт аудит"
    ON audit FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- audit не обновляется и не удаляется (append-only)
