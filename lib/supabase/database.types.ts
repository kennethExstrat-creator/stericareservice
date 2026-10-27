export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_review_actions: {
        Row: {
          action: Database["public"]["Enums"]["ai_review_action"]
          actor_id: string
          ai_review_id: string
          at: string
          created_at: string
          finding_id: string
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          action: Database["public"]["Enums"]["ai_review_action"]
          actor_id?: string
          ai_review_id: string
          at?: string
          created_at?: string
          finding_id: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["ai_review_action"]
          actor_id?: string
          ai_review_id?: string
          at?: string
          created_at?: string
          finding_id?: string
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_review_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_review_actions_ai_review_id_fkey"
            columns: ["ai_review_id"]
            isOneToOne: false
            referencedRelation: "ai_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reviews: {
        Row: {
          confidence: number | null
          created_at: string
          findings: NonNullable<Json>
          id: string
          inspection_fingerprint: string | null
          inspection_id: string
          inspection_updated_at: string
          model: string | null
          questions: NonNullable<Json>
          status: Database["public"]["Enums"]["ai_review_status"]
          suggested_result:
            | Database["public"]["Enums"]["inspection_result"]
            | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          findings?: NonNullable<Json>
          id?: string
          inspection_fingerprint?: string | null
          inspection_id: string
          inspection_updated_at: string
          model?: string | null
          questions?: NonNullable<Json>
          status?: Database["public"]["Enums"]["ai_review_status"]
          suggested_result?:
            | Database["public"]["Enums"]["inspection_result"]
            | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          findings?: NonNullable<Json>
          id?: string
          inspection_fingerprint?: string | null
          inspection_id?: string
          inspection_updated_at?: string
          model?: string | null
          questions?: NonNullable<Json>
          status?: Database["public"]["Enums"]["ai_review_status"]
          suggested_result?:
            | Database["public"]["Enums"]["inspection_result"]
            | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reviews_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          anthropic_api_key_encrypted: string | null
          anthropic_api_key_hint: string | null
          created_at: string
          document_model: string | null
          glossary: Json | null
          id: boolean
          prices: Json | null
          review_effort: string | null
          review_max_photos: number | null
          review_model: string | null
          summary_model: string | null
          summary_style: Json | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anthropic_api_key_encrypted?: string | null
          anthropic_api_key_hint?: string | null
          created_at?: string
          document_model?: string | null
          glossary?: Json | null
          id?: boolean
          prices?: Json | null
          review_effort?: string | null
          review_max_photos?: number | null
          review_model?: string | null
          summary_model?: string | null
          summary_style?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anthropic_api_key_encrypted?: string | null
          anthropic_api_key_hint?: string | null
          created_at?: string
          document_model?: string | null
          glossary?: Json | null
          id?: boolean
          prices?: Json | null
          review_effort?: string | null
          review_max_photos?: number | null
          review_model?: string | null
          summary_model?: string | null
          summary_style?: Json | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          actor_id: string | null
          cache_read_tokens: number
          cache_write_1h_tokens: number
          cache_write_5m_tokens: number
          cost_usd: number | null
          created_at: string
          duration_ms: number
          error_type: string | null
          feature: string
          id: string
          input_tokens: number
          inspection_id: string | null
          item_count: number
          model: string
          outcome: string
          output_tokens: number
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          cache_read_tokens?: number
          cache_write_1h_tokens?: number
          cache_write_5m_tokens?: number
          cost_usd?: number | null
          created_at?: string
          duration_ms: number
          error_type?: string | null
          feature: string
          id?: string
          input_tokens?: number
          inspection_id?: string | null
          item_count?: number
          model: string
          outcome: string
          output_tokens?: number
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          cache_read_tokens?: number
          cache_write_1h_tokens?: number
          cache_write_5m_tokens?: number
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number
          error_type?: string | null
          feature?: string
          id?: string
          input_tokens?: number
          inspection_id?: string | null
          item_count?: number
          model?: string
          outcome?: string
          output_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          changes: NonNullable<Json>
          created_at: string
          id: number
          inspection_id: string | null
          updated_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          changes?: NonNullable<Json>
          created_at?: string
          id?: never
          inspection_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          changes?: NonNullable<Json>
          created_at?: string
          id?: never
          inspection_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          logo_path: string | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      defect_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      inspection_files: {
        Row: {
          ai_filled_at: string | null
          ai_proposals: Json | null
          ai_read_at: string | null
          ai_status: string | null
          ai_summary: string | null
          created_at: string
          created_by: string
          id: string
          inspection_id: string
          kind: Database["public"]["Enums"]["inspection_file_kind"]
          module_key: string | null
          name: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          ai_filled_at?: string | null
          ai_proposals?: Json | null
          ai_read_at?: string | null
          ai_status?: string | null
          ai_summary?: string | null
          created_at?: string
          created_by?: string
          id?: string
          inspection_id: string
          kind?: Database["public"]["Enums"]["inspection_file_kind"]
          module_key?: string | null
          name: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          ai_filled_at?: string | null
          ai_proposals?: Json | null
          ai_read_at?: string | null
          ai_status?: string | null
          ai_summary?: string | null
          created_at?: string
          created_by?: string
          id?: string
          inspection_id?: string
          kind?: Database["public"]["Enums"]["inspection_file_kind"]
          module_key?: string | null
          name?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_files_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_files_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_photos: {
        Row: {
          ai_described_at: string | null
          ai_description: Json | null
          caption: string | null
          created_at: string
          created_by: string
          flagged: boolean
          height: number | null
          id: string
          include_in_report: boolean
          inspection_id: string
          markers: Json
          module_key: string | null
          storage_path: string
          taken_at: string | null
          target: string | null
          thumb_path: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          ai_described_at?: string | null
          ai_description?: Json | null
          caption?: string | null
          created_at?: string
          created_by?: string
          flagged?: boolean
          height?: number | null
          id?: string
          include_in_report?: boolean
          inspection_id: string
          markers?: Json
          module_key?: string | null
          storage_path: string
          taken_at?: string | null
          target?: string | null
          thumb_path?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          ai_described_at?: string | null
          ai_description?: Json | null
          caption?: string | null
          created_at?: string
          created_by?: string
          flagged?: boolean
          height?: number | null
          id?: string
          include_in_report?: boolean
          inspection_id?: string
          markers?: Json
          module_key?: string | null
          storage_path?: string
          taken_at?: string | null
          target?: string | null
          thumb_path?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string | null
          created_at: string
          data: NonNullable<Json>
          id: string
          inspection_date: string
          inspector_id: string
          lot_numbers: string[]
          manufacturer_id: string | null
          module_overrides: NonNullable<Json>
          po_no: string | null
          product_name: string | null
          ref_no: string
          remarks: string | null
          report_url: string | null
          result: Database["public"]["Enums"]["inspection_result"] | null
          status: Database["public"]["Enums"]["inspection_status"]
          submitted_at: string | null
          suggested_result:
            | Database["public"]["Enums"]["inspection_result"]
            | null
          template_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          data?: NonNullable<Json>
          id?: string
          inspection_date?: string
          inspector_id?: string
          lot_numbers?: string[]
          manufacturer_id?: string | null
          module_overrides?: NonNullable<Json>
          po_no?: string | null
          product_name?: string | null
          ref_no?: string
          remarks?: string | null
          report_url?: string | null
          result?: Database["public"]["Enums"]["inspection_result"] | null
          status?: Database["public"]["Enums"]["inspection_status"]
          submitted_at?: string | null
          suggested_result?:
            | Database["public"]["Enums"]["inspection_result"]
            | null
          template_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string | null
          created_at?: string
          data?: NonNullable<Json>
          id?: string
          inspection_date?: string
          inspector_id?: string
          lot_numbers?: string[]
          manufacturer_id?: string | null
          module_overrides?: NonNullable<Json>
          po_no?: string | null
          product_name?: string | null
          ref_no?: string
          remarks?: string | null
          report_url?: string | null
          result?: Database["public"]["Enums"]["inspection_result"] | null
          status?: Database["public"]["Enums"]["inspection_status"]
          submitted_at?: string | null
          suggested_result?:
            | Database["public"]["Enums"]["inspection_result"]
            | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_brands: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      manufacturer_companies: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_companies_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturers: {
        Row: {
          address: string | null
          company_id: string
          country: string | null
          created_at: string
          factory_name: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id: string
          country?: string | null
          created_at?: string
          factory_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string
          country?: string | null
          created_at?: string
          factory_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_lead: boolean
          joined_at: string | null
          lead_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          role_id: string
          signature_path: string | null
          uid: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_lead?: boolean
          joined_at?: string | null
          lead_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          role_id?: string
          signature_path?: string | null
          uid?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_lead?: boolean
          joined_at?: string | null
          lead_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          role_id?: string
          signature_path?: string | null
          uid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          access: string
          built_in: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          permissions: string[]
          updated_at: string
        }
        Insert: {
          access: string
          built_in?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          permissions?: string[]
          updated_at?: string
        }
        Update: {
          access?: string
          built_in?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          permissions?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      templates: {
        Row: {
          client_id: string | null
          code: string
          coverage_confirmed_at: string | null
          coverage_confirmed_by: string | null
          created_at: string
          definition: NonNullable<Json>
          extends_code: string | null
          id: string
          manufacturer_id: string | null
          product_type: Database["public"]["Enums"]["product_type"]
          resolved: Json | null
          source_file_path: string | null
          standard: Database["public"]["Enums"]["standard_code"]
          status: Database["public"]["Enums"]["template_status"]
          updated_at: string
          version: number
        }
        Insert: {
          client_id?: string | null
          code: string
          coverage_confirmed_at?: string | null
          coverage_confirmed_by?: string | null
          created_at?: string
          definition: NonNullable<Json>
          extends_code?: string | null
          id?: string
          manufacturer_id?: string | null
          product_type: Database["public"]["Enums"]["product_type"]
          resolved?: Json | null
          source_file_path?: string | null
          standard: Database["public"]["Enums"]["standard_code"]
          status?: Database["public"]["Enums"]["template_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string | null
          code?: string
          coverage_confirmed_at?: string | null
          coverage_confirmed_by?: string | null
          created_at?: string
          definition?: NonNullable<Json>
          extends_code?: string | null
          id?: string
          manufacturer_id?: string | null
          product_type?: Database["public"]["Enums"]["product_type"]
          resolved?: Json | null
          source_file_path?: string | null
          standard?: Database["public"]["Enums"]["standard_code"]
          status?: Database["public"]["Enums"]["template_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_coverage_confirmed_by_fkey"
            columns: ["coverage_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "templates_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_usage_by_inspection: {
        Args: { max_rows?: number; since?: string }
        Returns: {
          calls: number
          cost_usd: number
          documents: number
          inspection_count: number
          inspection_date: string
          inspection_id: string
          media_items: number
          po_no: string
          ref_no: string
          reviews: number
          status: Database["public"]["Enums"]["inspection_status"]
        }[]
      }
      ai_usage_summary: {
        Args: { since?: string }
        Returns: {
          cache_read_tokens: number
          cache_write_tokens: number
          calls: number
          cost_usd: number
          failed: number
          feature: string
          input_tokens: number
          model: string
          output_tokens: number
          units: number
          unlinked_cost_usd: number
          unpriced: number
        }[]
      }
      ai_usage_trend: {
        Args: { bucket?: string; since?: string }
        Returns: {
          bucket_start: string
          calls: number
          cost_usd: number
          feature: string
        }[]
      }
      can_edit_inspection: { Args: { inspection_id: string }; Returns: boolean }
      builtin_role_id: { Args: { kind: string }; Returns: string }
      can_read_inspection: { Args: { inspection_id: string }; Returns: boolean }
      complete_account: {
        Args: { p_full_name: string; p_phone: string }
        Returns: undefined
      }
      create_inspection: {
        Args: {
          actor_id: string
          client_id?: string
          data?: Json
          manufacturer_id: string
          mirrored_columns?: Json
          template_id: string
        }
        Returns: string
      }
      delete_draft_inspection: {
        Args: { inspection_id: string }
        Returns: Json
      }
      delete_test_inspection: {
        Args: { inspection_id: string }
        Returns: boolean
      }
      inspection_ref: {
        Args: { created: string; seq: number }
        Returns: string
      }
      is_active: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_lead: { Args: Record<PropertyKey, never>; Returns: boolean }
      leads: { Args: { inspector: string }; Returns: boolean }
      leads_ai_review: { Args: { ai_review_id: string }; Returns: boolean }
      leads_inspection: { Args: { inspection_id: string }; Returns: boolean }
      log_inspection_event: {
        Args: { action: string; changes?: Json; inspection_id: string }
        Returns: number
      }
      has_permission: { Args: { permission: string }; Returns: boolean }
      is_full_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      my_role: {
        Args: Record<PropertyKey, never>
        Returns: {
          access: string
          built_in: string
          id: string
          name: string
          permissions: string[]
        }[]
      }
      my_profile_status: {
        Args: Record<PropertyKey, never>
        Returns: {
          active: boolean
          is_lead: boolean
          lead_id: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      my_team: { Args: Record<PropertyKey, never>; Returns: string[] }
      profile_uid: { Args: { seq: number }; Returns: string }
      save_inspection: {
        Args: {
          actor_id: string
          base_updated_at: string
          data: Json
          inspection_id: string
          mirrored_columns?: Json
        }
        Returns: string
      }
      save_inspection_with_events: {
        Args: {
          actor_id: string
          base_updated_at: string
          data: Json
          events?: Json
          inspection_id: string
          mirrored_columns?: Json
        }
        Returns: string
      }
      storage_folder_uuid: { Args: { object_name: string }; Returns: string }
      storage_inspection_id: { Args: { object_name: string }; Returns: string }
      submit_inspection: {
        Args: {
          actor_id: string
          base_updated_at: string
          inspection_id: string
          mirrored_columns?: Json
        }
        Returns: string
      }
    }
    Enums: {
      ai_review_action: "agree" | "disagree" | "fixed"
      ai_review_status: "pending" | "done" | "failed"
      inspection_file_kind: "lab_report" | "certificate" | "other"
      inspection_result: "pass" | "fail" | "hold"
      inspection_status: "draft" | "submitted" | "approved" | "reopened"
      product_type: "examination" | "surgical"
      standard_code:
        | "EN455"
        | "ASTM_D6319"
        | "ASTM_D3578"
        | "ASTM_D3577"
        | "custom"
      template_status: "draft" | "active" | "retired"
      user_role: "inspector" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ai_review_action: ["agree", "disagree", "fixed"],
      ai_review_status: ["pending", "done", "failed"],
      inspection_file_kind: ["lab_report", "certificate", "other"],
      inspection_result: ["pass", "fail", "hold"],
      inspection_status: ["draft", "submitted", "approved", "reopened"],
      product_type: ["examination", "surgical"],
      standard_code: [
        "EN455",
        "ASTM_D6319",
        "ASTM_D3578",
        "ASTM_D3577",
        "custom",
      ],
      template_status: ["draft", "active", "retired"],
      user_role: ["inspector", "admin"],
    },
  },
} as const
