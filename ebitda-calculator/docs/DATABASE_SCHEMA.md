# Схема базы данных — EBITDA Калькулятор

## Обзор таблиц

```
┌─────────────────┐     ┌─────────────────┐
│   auth.users    │     │   workspaces    │
│   (Supabase)    │     │                 │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │    ┌──────────────────┤
         │    │                  │
         ▼    ▼                  │
┌─────────────────┐              │
│   memberships   │              │
│ (user_id, ws_id)│              │
└─────────────────┘              │
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     configs     │     │     months      │     │     ledger      │
│ (версии настроек)│     │ (данные месяцев)│     │ (операции банка)│
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  year_configs   │     │    quarters     │     │      years      │
│ (привязка к году)│     │ (агрегаты Q1-Q4)│     │ (агрегаты года) │
└─────────────────┘     └─────────────────┘     └─────────────────┘

                        ┌─────────────────┐
                        │      audit      │
                        │ (журнал аудита) │
                        └─────────────────┘
```

---

## Таблица: workspaces

**Описание:** Организации/компании (multi-tenant).

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| name | TEXT | NOT NULL | Название организации |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата создания |
| created_by | UUID | FK → auth.users(id) | Кто создал |

**Индексы:** PK на id.

---

## Таблица: memberships

**Описание:** Связь пользователей с организациями и их роли.

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| user_id | UUID | NOT NULL, FK → auth.users(id) ON DELETE CASCADE | Пользователь |
| role | TEXT | NOT NULL, CHECK IN ('admin', 'viewer') | Роль |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата создания |

**Индексы:**
- PK на id
- UNIQUE (workspace_id, user_id)
- INDEX на user_id
- INDEX на workspace_id

---

## Таблица: configs

**Описание:** Версии конфигураций мотивационной схемы.

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| version | INTEGER | NOT NULL | Номер версии (1, 2, 3...) |
| name | TEXT | | Название версии |
| fixed_monthly | INTEGER | NOT NULL, DEFAULT 180000 | Фикс. оклад (₽) |
| annual_ebitda_base | INTEGER | NOT NULL, DEFAULT 10000000 | Годовая база EBITDA (₽) |
| kpi_growth_threshold_pct | NUMERIC(5,4) | NOT NULL, DEFAULT 0.10 | Порог роста KPI (доля) |
| retention_max | INTEGER | NOT NULL, DEFAULT 80000 | Макс. удержание (₽) |
| growth_rate | NUMERIC(5,4) | NOT NULL, DEFAULT 0.25 | Ставка роста (доля) |
| bank_split_pct | NUMERIC(5,4) | NOT NULL, DEFAULT 0.50 | Доля в банк (доля) |
| quarter_payout_pct | NUMERIC(5,4) | NOT NULL, DEFAULT 0.50 | Доля квартальной выплаты (доля) |
| quarterly_condition_pct | NUMERIC(5,4) | NOT NULL, DEFAULT 0.00 | Условие квартала (доля) |
| year_condition_pct | NUMERIC(5,4) | NOT NULL, DEFAULT 0.10 | Условие года (доля) |
| tiered_growth_enabled | BOOLEAN | NOT NULL, DEFAULT false | Вкл. градационный рост |
| tiered_growth_json | JSONB | DEFAULT '[]' | Зоны градации |
| quarter_payout_method | TEXT | NOT NULL, DEFAULT 'quarter_accrual', CHECK IN ('quarter_accrual', 'current_balance') | Метод расчёта квартальной выплаты |
| created_by | UUID | FK → auth.users(id) | Кто создал |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата создания |

**Индексы:**
- PK на id
- UNIQUE (workspace_id, version)
- INDEX на workspace_id

**Формат tiered_growth_json:**
```json
[
  {"from": "threshold", "to": 1200000, "rate": 0.20},
  {"from": 1200000, "to": 1600000, "rate": 0.25},
  {"from": 1600000, "to": null, "rate": 0.30}
]
```

---

## Таблица: year_configs

**Описание:** Привязка конфигурации к году (с возможностью смены с определённого месяца).

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| year | INTEGER | NOT NULL | Год |
| config_id | UUID | NOT NULL, FK → configs(id) | Конфигурация |
| effective_from_month | INTEGER | NOT NULL, DEFAULT 1, CHECK 1-12 | С какого месяца действует |
| locked | BOOLEAN | NOT NULL, DEFAULT false | Год закрыт (конфиг заморожен) |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата создания |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Дата обновления |

**Индексы:**
- PK на id
- UNIQUE (workspace_id, year, effective_from_month)
- INDEX на (workspace_id, year)

---

## Таблица: months

**Описание:** Месячные данные с EBITDA и расчётными полями.

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| year | INTEGER | NOT NULL | Год |
| month | INTEGER | NOT NULL, CHECK 1-12 | Месяц (1=январь) |
| ebitda | INTEGER | | Введённая EBITDA (NULL = не введено) |
| comment | TEXT | | Комментарий |
| locked | BOOLEAN | NOT NULL, DEFAULT false | Месяц заблокирован |
| config_id | UUID | FK → configs(id) | По какой конфигурации считался |
| monthly_base | INTEGER | | Расчётная месячная база |
| monthly_threshold | INTEGER | | Расчётный месячный порог |
| retention | INTEGER | DEFAULT 0 | Удержание |
| growth_bonus | INTEGER | DEFAULT 0 | Бонус за рост |
| total_bonus | INTEGER | DEFAULT 0 | Итого бонус |
| paid_now | INTEGER | DEFAULT 0 | Выплачено сразу |
| to_bank | INTEGER | DEFAULT 0 | В банк |
| bank_balance_after | INTEGER | DEFAULT 0 | Остаток банка после месяца |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата создания |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Дата обновления |

**Индексы:**
- PK на id
- UNIQUE (workspace_id, year, month)
- INDEX на (workspace_id, year)

---

## Таблица: quarters

**Описание:** Агрегированные данные по кварталам.

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| year | INTEGER | NOT NULL | Год |
| quarter | INTEGER | NOT NULL, CHECK 1-4 | Квартал |
| ebitda_sum | INTEGER | DEFAULT 0 | Сумма EBITDA за квартал |
| to_bank_sum | INTEGER | DEFAULT 0 | Сумма начислений в банк |
| condition_threshold | INTEGER | DEFAULT 0 | Порог условия квартала |
| condition_met | BOOLEAN | DEFAULT false | Условие выполнено |
| payout_available | INTEGER | DEFAULT 0 | Доступно к выплате |
| payout_done | BOOLEAN | DEFAULT false | Выплата выполнена |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Дата обновления |

**Индексы:**
- PK на id
- UNIQUE (workspace_id, year, quarter)
- INDEX на (workspace_id, year)

---

## Таблица: years

**Описание:** Агрегированные данные по году.

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| year | INTEGER | NOT NULL | Год |
| ebitda_sum | INTEGER | DEFAULT 0 | Сумма EBITDA за год |
| total_bonus_sum | INTEGER | DEFAULT 0 | Сумма бонусов |
| paid_now_sum | INTEGER | DEFAULT 0 | Сумма выплаченного сразу |
| to_bank_sum | INTEGER | DEFAULT 0 | Сумма начислений в банк |
| condition_threshold | INTEGER | DEFAULT 0 | Порог условия года |
| condition_met | BOOLEAN | DEFAULT false | Условие выполнено |
| closed | BOOLEAN | DEFAULT false | Год закрыт |
| closed_at | TIMESTAMPTZ | | Дата закрытия |
| updated_at | TIMESTAMPTZ | DEFAULT now() | Дата обновления |

**Индексы:**
- PK на id
- UNIQUE (workspace_id, year)
- INDEX на workspace_id

---

## Таблица: ledger

**Описание:** Журнал операций с банком (append-only).

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| year | INTEGER | NOT NULL | Год |
| operation_type | TEXT | NOT NULL, CHECK IN (...) | Тип операции |
| month | INTEGER | | Месяц (для month_accrual) |
| quarter | INTEGER | | Квартал (для quarter_payout) |
| amount | INTEGER | NOT NULL | Сумма (+/-) |
| balance_after | INTEGER | NOT NULL | Остаток после операции |
| comment | TEXT | | Комментарий |
| idempotency_key | TEXT | | Ключ идемпотентности |
| created_by | UUID | FK → auth.users(id) | Кто выполнил |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата операции |

**Типы операций (operation_type):**
- `year_start` — начало года (баланс = 0)
- `month_accrual` — начисление в банк за месяц
- `quarter_payout` — квартальная выплата
- `year_payout` — годовая выплата
- `manual_adjustment` — ручная корректировка
- `recalc_adjustment` — корректировка при перерасчёте

**Индексы:**
- PK на id
- UNIQUE (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL — **для идемпотентности**
- INDEX на (workspace_id, year)

**Идемпотентность:**
- Квартальная выплата: `idempotency_key = '{workspace_id}:{year}:Q{quarter}:payout'`
- Годовая выплата: `idempotency_key = '{workspace_id}:{year}:year_payout'`

---

## Таблица: audit

**Описание:** Журнал аудита изменений (append-only).

| Поле | Тип | Constraints | Описание |
|------|-----|-------------|----------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Уникальный ID |
| workspace_id | UUID | NOT NULL, FK → workspaces(id) ON DELETE CASCADE | Организация |
| entity_type | TEXT | NOT NULL | Тип сущности |
| entity_id | UUID | | ID сущности |
| action | TEXT | NOT NULL | Действие |
| old_values | JSONB | | Старые значения |
| new_values | JSONB | | Новые значения |
| user_id | UUID | FK → auth.users(id) | Кто выполнил |
| created_at | TIMESTAMPTZ | DEFAULT now() | Дата |

**Индексы:**
- PK на id
- INDEX на (workspace_id, created_at DESC)
- INDEX на (entity_type, entity_id)

---

## Связи между таблицами

```
workspaces (1) ──< (N) memberships (N) >── (1) auth.users
workspaces (1) ──< (N) configs
workspaces (1) ──< (N) year_configs >── configs
workspaces (1) ──< (N) months >── configs
workspaces (1) ──< (N) quarters
workspaces (1) ──< (N) years
workspaces (1) ──< (N) ledger
workspaces (1) ──< (N) audit
```

---

## Уникальные ограничения для идемпотентности

| Таблица | Constraint | Назначение |
|---------|------------|------------|
| memberships | UNIQUE (workspace_id, user_id) | Один пользователь — одно членство в workspace |
| configs | UNIQUE (workspace_id, version) | Уникальная версия конфига в workspace |
| year_configs | UNIQUE (workspace_id, year, effective_from_month) | Одна конфигурация на период |
| months | UNIQUE (workspace_id, year, month) | Один месяц — одна запись |
| quarters | UNIQUE (workspace_id, year, quarter) | Один квартал — одна запись |
| years | UNIQUE (workspace_id, year) | Один год — одна запись |
| ledger | UNIQUE (workspace_id, idempotency_key) WHERE NOT NULL | **Защита от повторных выплат** |

---

## RLS-политики (Row Level Security)

### Принципы:
1. Пользователь видит только данные своих workspaces (через memberships)
2. Админ может изменять, viewer только читать
3. Закрытые года/месяцы защищены от изменений

### Вспомогательные функции:
```sql
is_workspace_member(ws_id UUID) → BOOLEAN
is_workspace_admin(ws_id UUID) → BOOLEAN
```

### Политики по таблицам:

| Таблица | SELECT | INSERT | UPDATE | DELETE |
|---------|--------|--------|--------|--------|
| workspaces | member | auth user | admin | — |
| memberships | member | auth user | admin | admin |
| configs | member | admin | — | — |
| year_configs | member | admin | admin (if not locked) | — |
| months | member | admin | admin (if not locked & year not closed) | — |
| quarters | member | admin | admin | — |
| years | member | admin | admin | — |
| ledger | member | admin | — | — |
| audit | member | auth user | — | — |
