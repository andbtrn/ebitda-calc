export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          name: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
          created_by?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
          created_by?: string
        }
      }
      memberships: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          role: 'admin' | 'viewer'
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          role: 'admin' | 'viewer'
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          role?: 'admin' | 'viewer'
          created_at?: string
        }
      }
      configs: {
        Row: {
          id: string
          workspace_id: string
          version: number
          name: string | null
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
          tiered_growth_json: TieredGrowthZone[]
          quarter_payout_method: 'quarter_accrual' | 'current_balance'
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          version: number
          name?: string
          fixed_monthly?: number
          annual_ebitda_base?: number
          kpi_growth_threshold_pct?: number
          retention_max?: number
          growth_rate?: number
          bank_split_pct?: number
          quarter_payout_pct?: number
          quarterly_condition_pct?: number
          year_condition_pct?: number
          tiered_growth_enabled?: boolean
          tiered_growth_json?: TieredGrowthZone[]
          quarter_payout_method?: 'quarter_accrual' | 'current_balance'
          created_by?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['configs']['Insert']>
      }
      year_configs: {
        Row: {
          id: string
          workspace_id: string
          year: number
          config_id: string
          effective_from_month: number
          locked: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          year: number
          config_id: string
          effective_from_month?: number
          locked?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['year_configs']['Insert']>
      }
      months: {
        Row: {
          id: string
          workspace_id: string
          year: number
          month: number
          ebitda: number | null
          comment: string | null
          locked: boolean
          config_id: string | null
          monthly_base: number | null
          monthly_threshold: number | null
          retention: number
          growth_bonus: number
          total_bonus: number
          paid_now: number
          to_bank: number
          bank_balance_after: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          year: number
          month: number
          ebitda?: number | null
          comment?: string | null
          locked?: boolean
          config_id?: string | null
          monthly_base?: number | null
          monthly_threshold?: number | null
          retention?: number
          growth_bonus?: number
          total_bonus?: number
          paid_now?: number
          to_bank?: number
          bank_balance_after?: number
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['months']['Insert']>
      }
      quarters: {
        Row: {
          id: string
          workspace_id: string
          year: number
          quarter: number
          ebitda_sum: number
          to_bank_sum: number
          condition_threshold: number
          condition_met: boolean
          payout_available: number
          payout_done: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          year: number
          quarter: number
          ebitda_sum?: number
          to_bank_sum?: number
          condition_threshold?: number
          condition_met?: boolean
          payout_available?: number
          payout_done?: boolean
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['quarters']['Insert']>
      }
      years: {
        Row: {
          id: string
          workspace_id: string
          year: number
          ebitda_sum: number
          total_bonus_sum: number
          paid_now_sum: number
          to_bank_sum: number
          condition_threshold: number
          condition_met: boolean
          closed: boolean
          closed_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          year: number
          ebitda_sum?: number
          total_bonus_sum?: number
          paid_now_sum?: number
          to_bank_sum?: number
          condition_threshold?: number
          condition_met?: boolean
          closed?: boolean
          closed_at?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['years']['Insert']>
      }
      ledger: {
        Row: {
          id: string
          workspace_id: string
          year: number
          operation_type:
            | 'month_accrual'
            | 'quarter_payout'
            | 'year_payout'
            | 'manual_adjustment'
            | 'recalc_adjustment'
            | 'year_start'
          month: number | null
          quarter: number | null
          amount: number
          balance_after: number
          comment: string | null
          idempotency_key: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          year: number
          operation_type:
            | 'month_accrual'
            | 'quarter_payout'
            | 'year_payout'
            | 'manual_adjustment'
            | 'recalc_adjustment'
            | 'year_start'
          month?: number | null
          quarter?: number | null
          amount: number
          balance_after: number
          comment?: string | null
          idempotency_key?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['ledger']['Insert']>
      }
      audit: {
        Row: {
          id: string
          workspace_id: string
          entity_type: string
          entity_id: string | null
          action: string
          old_values: Record<string, unknown> | null
          new_values: Record<string, unknown> | null
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          entity_type: string
          entity_id?: string | null
          action: string
          old_values?: Record<string, unknown> | null
          new_values?: Record<string, unknown> | null
          user_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['audit']['Insert']>
      }
    }
    Functions: {
      init_year: {
        Args: { p_workspace_id: string; p_year: number }
        Returns: unknown
      }
      recalculate_year: {
        Args: { p_workspace_id: string; p_year: number }
        Returns: unknown
      }
      update_month_ebitda: {
        Args: {
          p_workspace_id: string
          p_year: number
          p_month: number
          p_ebitda: number
          p_comment?: string
        }
        Returns: unknown
      }
      toggle_month_lock: {
        Args: {
          p_workspace_id: string
          p_year: number
          p_month: number
          p_locked: boolean
        }
        Returns: unknown
      }
      execute_quarter_payout: {
        Args: { p_workspace_id: string; p_year: number; p_quarter: number }
        Returns: unknown
      }
      execute_year_payout: {
        Args: { p_workspace_id: string; p_year: number }
        Returns: unknown
      }
      adjust_bank: {
        Args: {
          p_workspace_id: string
          p_year: number
          p_amount: number
          p_comment: string
        }
        Returns: unknown
      }
      create_workspace: {
        Args: { p_name: string }
        Returns: unknown
      }
      create_config_version: {
        Args: {
          p_workspace_id: string
          p_name: string
          p_fixed_monthly: number
          p_annual_ebitda_base: number
          p_kpi_growth_threshold_pct: number
          p_retention_max: number
          p_growth_rate: number
          p_bank_split_pct: number
          p_quarter_payout_pct: number
          p_quarterly_condition_pct: number
          p_year_condition_pct: number
          p_tiered_growth_enabled: boolean
          p_tiered_growth_json: unknown
          p_quarter_payout_method: string
        }
        Returns: unknown
      }
      assign_config_to_year: {
        Args: {
          p_workspace_id: string
          p_year: number
          p_config_id: string
          p_effective_from_month?: number
        }
        Returns: unknown
      }
      get_bank_balance: {
        Args: { p_workspace_id: string; p_year: number }
        Returns: number
      }
    }
  }
}

export interface TieredGrowthZone {
  from: 'threshold' | number
  to: number | null
  rate: number
}

export type Workspace = Database['public']['Tables']['workspaces']['Row']
export type Membership = Database['public']['Tables']['memberships']['Row']
export type Config = Database['public']['Tables']['configs']['Row']
export type YearConfig = Database['public']['Tables']['year_configs']['Row']
export type Month = Database['public']['Tables']['months']['Row']
export type Quarter = Database['public']['Tables']['quarters']['Row']
export type Year = Database['public']['Tables']['years']['Row']
export type Ledger = Database['public']['Tables']['ledger']['Row']
export type Audit = Database['public']['Tables']['audit']['Row']
