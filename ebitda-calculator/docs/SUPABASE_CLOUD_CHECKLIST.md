# Чеклист: Настройка Supabase Cloud

## Шаг 1: Создание проекта

1. [ ] Перейти на [supabase.com](https://supabase.com) и войти в аккаунт
2. [ ] Нажать **"New Project"**
3. [ ] Заполнить:
   - **Name**: `ebitda-calculator` (или любое)
   - **Database Password**: сохранить в безопасное место!
   - **Region**: выбрать ближайший (eu-central-1 для Европы)
   - **Pricing Plan**: Free tier достаточно для MVP
4. [ ] Дождаться создания проекта (1-2 минуты)

---

## Шаг 2: Получение credentials

1. [ ] Перейти в **Project Settings** → **API**
2. [ ] Скопировать и сохранить:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGci...` (длинный JWT)
   - **service_role key**: только для бэкенда, не использовать на фронте!

---

## Шаг 3: Применение миграции

### Вариант A: Через SQL Editor (рекомендуется)

1. [ ] Перейти в **SQL Editor** в левом меню
2. [ ] Нажать **"+ New query"**
3. [ ] Скопировать **весь** SQL из файла:
   ```
   /supabase/migrations/20240101000000_full_schema.sql
   ```
4. [ ] Вставить в редактор
5. [ ] Нажать **"Run"** (Ctrl+Enter)
6. [ ] Убедиться, что нет ошибок (зелёная галочка)

### Вариант B: Через Supabase CLI (опционально)

```bash
# Установка CLI
npm install -g supabase

# Линковка с проектом
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Применение миграций
supabase db push
```

---

## Шаг 4: Проверка созданных объектов

После применения миграции проверьте в **Table Editor**:

### Таблицы (должно быть 8):
- [ ] `workspaces`
- [ ] `memberships`
- [ ] `configs`
- [ ] `year_configs`
- [ ] `months`
- [ ] `quarters`
- [ ] `years`
- [ ] `ledger`
- [ ] `audit`

### RPC-функции (Database → Functions):
- [ ] `create_workspace`
- [ ] `init_year`
- [ ] `recalculate_year`
- [ ] `update_month_ebitda`
- [ ] `toggle_month_lock`
- [ ] `execute_quarter_payout`
- [ ] `execute_year_payout`
- [ ] `adjust_bank`
- [ ] `create_config_version`
- [ ] `assign_config_to_year`
- [ ] `get_config_for_month`
- [ ] `calculate_month_values`
- [ ] `is_workspace_member`
- [ ] `is_workspace_admin`

### RLS-политики (Authentication → Policies):
Для каждой таблицы должны быть политики SELECT/INSERT/UPDATE.

---

## Шаг 5: Настройка Authentication

1. [ ] Перейти в **Authentication** → **Providers**
2. [ ] Убедиться, что **Email** включён
3. [ ] В **Settings**:
   - [ ] **Site URL**: `http://localhost:5173` (для разработки)
   - [ ] **Redirect URLs**: добавить `http://localhost:5173/*`
4. [ ] **Email Templates** (опционально): русифицировать тексты писем

---

## Шаг 6: Настройка CORS (если нужно)

По умолчанию Supabase разрешает запросы с любых доменов.
Для продакшена рекомендуется ограничить:

1. [ ] **Project Settings** → **API**
2. [ ] В разделе **CORS** добавить разрешённые домены

---

## Шаг 7: Тестирование через SQL Editor

Выполните тестовые запросы для проверки:

```sql
-- 1. Проверка таблиц
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- 2. Проверка RPC функций
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- 3. Проверка RLS
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public' ORDER BY tablename;

-- 4. Проверка индекса идемпотентности (критично!)
SELECT indexname, indexdef FROM pg_indexes
WHERE indexname = 'idx_ledger_idempotency';
```

---

## Шаг 8: Создание тестового пользователя

1. [ ] **Authentication** → **Users** → **Add user**
2. [ ] Создать пользователя с email/паролем
3. [ ] Или использовать Sign Up через приложение

---

## Шаг 9: Проверка RPC через REST API

Можно проверить API через curl или Postman:

```bash
# Пример вызова create_workspace
curl -X POST 'https://YOUR_PROJECT.supabase.co/rest/v1/rpc/create_workspace' \
  -H 'apikey: YOUR_ANON_KEY' \
  -H 'Authorization: Bearer YOUR_USER_JWT' \
  -H 'Content-Type: application/json' \
  -d '{"p_name": "Тестовая организация"}'
```

---

## Шаг 10: Переменные окружения для фронтенда

Создайте файл `/web/.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...ваш_anon_key
```

**Важно:**
- НЕ коммитьте `.env` в git
- НЕ используйте `service_role` key на фронтенде

---

## Готово!

После выполнения всех шагов:
- [ ] База данных настроена
- [ ] RLS защищает данные
- [ ] RPC функции доступны
- [ ] Можно запускать фронтенд

---

## Troubleshooting

### Ошибка "permission denied"
- Проверьте, что RLS включён для таблицы
- Проверьте, что пользователь авторизован

### Ошибка "function does not exist"
- Убедитесь, что миграция применена полностью
- Проверьте логи в **Logs** → **Postgres logs**

### Ошибка "duplicate key value violates unique constraint"
- Идемпотентность работает корректно!
- Это ожидаемое поведение при повторной выплате

### Ошибка при создании функций
- Возможно, часть SQL не выполнилась
- Попробуйте выполнить миграцию частями
