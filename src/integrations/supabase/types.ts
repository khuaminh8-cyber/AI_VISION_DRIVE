export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      app_games: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          route: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          route: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          route?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      badge_quests: {
        Row: {
          claimed: boolean
          completed_at: string
          id: string
          quest_type: string
          user_id: string
        }
        Insert: {
          claimed?: boolean
          completed_at?: string
          id?: string
          quest_type: string
          user_id: string
        }
        Update: {
          claimed?: boolean
          completed_at?: string
          id?: string
          quest_type?: string
          user_id?: string
        }
        Relationships: []
      }
      badges: {
        Row: {
          code: string
          created_at: string
          gradient_from: string
          gradient_to: string
          icon: string
          id: string
          name: string
          rarity: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          gradient_from: string
          gradient_to: string
          icon: string
          id?: string
          name: string
          rarity: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          gradient_from?: string
          gradient_to?: string
          icon?: string
          id?: string
          name?: string
          rarity?: string
          sort_order?: number
        }
        Relationships: []
      }
      friend_help_claims: {
        Row: {
          badge_code: string
          claimed_at: string
          from_user_id: string
          id: string
          receiver_id: string
        }
        Insert: {
          badge_code: string
          claimed_at?: string
          from_user_id: string
          id?: string
          receiver_id: string
        }
        Update: {
          badge_code?: string
          claimed_at?: string
          from_user_id?: string
          id?: string
          receiver_id?: string
        }
        Relationships: []
      }
      monthly_access_config: {
        Row: {
          enabled: boolean
          id: number
          points_per_month: number
          reset_day: number
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: number
          points_per_month?: number
          reset_day?: number
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: number
          points_per_month?: number
          reset_day?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          full_name: string
          id: string
          phone: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          full_name: string
          id?: string
          phone?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rental_request_vouchers: {
        Row: {
          created_at: string
          id: string
          request_id: string
          resolved_at: string | null
          status: string
          user_id: string
          user_voucher_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          request_id: string
          resolved_at?: string | null
          status?: string
          user_id: string
          user_voucher_id: string
        }
        Update: {
          created_at?: string
          id?: string
          request_id?: string
          resolved_at?: string | null
          status?: string
          user_id?: string
          user_voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_request_vouchers_user_voucher_id_fkey"
            columns: ["user_voucher_id"]
            isOneToOne: false
            referencedRelation: "user_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      room_requests: {
        Row: {
          admin_note: string | null
          created_at: string | null
          id: string
          message: string | null
          room_id: string
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          admin_note?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          room_id: string
          status?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          admin_note?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          room_id?: string
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_requests_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          address_detail: string
          amenities: string[] | null
          area: number | null
          created_at: string | null
          description: string | null
          district: string
          id: string
          images: string[] | null
          is_available: boolean | null
          landlord_id: string
          latitude: number | null
          longitude: number | null
          phone: string
          price: number
          province: string
          room_number: string
          title: string
          updated_at: string | null
          videos: string[] | null
          ward: string
        }
        Insert: {
          address_detail: string
          amenities?: string[] | null
          area?: number | null
          created_at?: string | null
          description?: string | null
          district: string
          id?: string
          images?: string[] | null
          is_available?: boolean | null
          landlord_id: string
          latitude?: number | null
          longitude?: number | null
          phone: string
          price: number
          province: string
          room_number: string
          title: string
          updated_at?: string | null
          videos?: string[] | null
          ward: string
        }
        Update: {
          address_detail?: string
          amenities?: string[] | null
          area?: number | null
          created_at?: string | null
          description?: string | null
          district?: string
          id?: string
          images?: string[] | null
          is_available?: boolean | null
          landlord_id?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string
          price?: number
          province?: string
          room_number?: string
          title?: string
          updated_at?: string | null
          videos?: string[] | null
          ward?: string
        }
        Relationships: []
      }
      user_badges: {
        Row: {
          badge_id: string
          id: string
          obtained_at: string
          user_id: string
        }
        Insert: {
          badge_id: string
          id?: string
          obtained_at?: string
          user_id: string
        }
        Update: {
          badge_id?: string
          id?: string
          obtained_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
        ]
      }
      user_monthly_access: {
        Row: {
          id: string
          paid_at: string
          period: string
          points_spent: number
          source: string
          user_id: string
          voucher_id: string | null
        }
        Insert: {
          id?: string
          paid_at?: string
          period: string
          points_spent?: number
          source?: string
          user_id: string
          voucher_id?: string | null
        }
        Update: {
          id?: string
          paid_at?: string
          period?: string
          points_spent?: number
          source?: string
          user_id?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_monthly_access_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_vouchers: {
        Row: {
          claimed_at: string
          expires_at: string | null
          held_for_request: string | null
          id: string
          months_remaining: number
          status: string
          used_at: string | null
          user_id: string
          voucher_id: string
        }
        Insert: {
          claimed_at?: string
          expires_at?: string | null
          held_for_request?: string | null
          id?: string
          months_remaining?: number
          status?: string
          used_at?: string | null
          user_id: string
          voucher_id: string
        }
        Update: {
          claimed_at?: string
          expires_at?: string | null
          held_for_request?: string | null
          id?: string
          months_remaining?: number
          status?: string
          used_at?: string | null
          user_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_vouchers_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_calls: {
        Row: {
          callee_id: string
          caller_id: string
          duration_sec: number
          ended_at: string | null
          id: string
          is_stranger: boolean
          started_at: string
          status: string
        }
        Insert: {
          callee_id: string
          caller_id: string
          duration_sec?: number
          ended_at?: string | null
          id?: string
          is_stranger?: boolean
          started_at?: string
          status?: string
        }
        Update: {
          callee_id?: string
          caller_id?: string
          duration_sec?: number
          ended_at?: string | null
          id?: string
          is_stranger?: boolean
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      voucher_device_claims: {
        Row: {
          claimed_at: string
          fingerprint: string
          user_id: string
          voucher_id: string
        }
        Insert: {
          claimed_at?: string
          fingerprint: string
          user_id: string
          voucher_id: string
        }
        Update: {
          claimed_at?: string
          fingerprint?: string
          user_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_device_claims_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          audience: string
          claim_limit_count: number | null
          claim_limit_type: string
          code: string | null
          created_at: string
          created_by: string | null
          discount_amount: number | null
          discount_percent: number | null
          expires_at: string | null
          extend_months: number | null
          id: string
          is_active: boolean
          is_free: boolean
          new_user_days: number
          note: string | null
          points_cost: number | null
          remaining: number
          total_quantity: number
          type: string
          updated_at: string
        }
        Insert: {
          audience?: string
          claim_limit_count?: number | null
          claim_limit_type?: string
          code?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          expires_at?: string | null
          extend_months?: number | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          new_user_days?: number
          note?: string | null
          points_cost?: number | null
          remaining?: number
          total_quantity?: number
          type: string
          updated_at?: string
        }
        Update: {
          audience?: string
          claim_limit_count?: number | null
          claim_limit_type?: string
          code?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          expires_at?: string | null
          extend_months?: number | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          new_user_days?: number
          note?: string | null
          points_cost?: number | null
          remaining?: number
          total_quantity?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_voucher: {
        Args: {
          _code: string
          _discount_percent: number
          _expires_at: string
          _new_user_days: number
          _note: string
          _points_cost: number
          _quantity: number
          _type: string
        }
        Returns: Json
      }
      admin_create_voucher_v2: {
        Args: {
          _audience: string
          _claim_limit_count: number
          _claim_limit_type: string
          _code: string
          _discount_amount: number
          _discount_percent: number
          _expires_at: string
          _extend_months: number
          _is_free: boolean
          _new_user_days: number
          _note: string
          _points_cost: number
          _quantity: number
          _type: string
        }
        Returns: Json
      }
      admin_delete_voucher: { Args: { _id: string }; Returns: Json }
      admin_extend_voucher: {
        Args: { _extra_quantity: number; _id: string; _new_expires_at: string }
        Returns: Json
      }
      admin_toggle_voucher: {
        Args: { _active: boolean; _id: string }
        Returns: Json
      }
      admin_upsert_monthly_config: {
        Args: { _enabled: boolean; _points: number; _reset_day: number }
        Returns: Json
      }
      claim_badge_piece: { Args: never; Returns: Json }
      claim_free_voucher: {
        Args: { _fingerprint?: string; _voucher_id: string }
        Returns: Json
      }
      claim_friend_help: {
        Args: { p_badge_code: string; p_from: string }
        Returns: Json
      }
      claim_new_user_voucher: { Args: { _voucher_id: string }; Returns: Json }
      confirm_voucher_for_request: {
        Args: { _request_id: string }
        Returns: Json
      }
      consume_monthly_access: {
        Args: { _user_voucher_id: string }
        Returns: Json
      }
      current_access_period: { Args: never; Returns: string }
      generate_display_id: { Args: never; Returns: string }
      get_admin_user_id: { Args: never; Returns: string }
      has_monthly_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hold_voucher_for_request: {
        Args: { _request_id: string; _user_voucher_id: string }
        Returns: Json
      }
      is_first_user: { Args: never; Returns: boolean }
      perform_daily_checkin: {
        Args: { _fingerprint?: string; _user_id: string }
        Returns: Json
      }
      perform_reward_action: {
        Args: { _action_type: string; _fingerprint?: string; _user_id: string }
        Returns: Json
      }
      redeem_voucher_with_points: {
        Args: { _voucher_id: string }
        Returns: Json
      }
      release_voucher_for_request: {
        Args: { _reason: string; _request_id: string }
        Returns: Json
      }
      share_badge_to_friends: {
        Args: {
          p_badge_id: string
          p_group_ids?: string[]
          p_user_ids?: string[]
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "landlord" | "tenant"
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
      app_role: ["admin", "landlord", "tenant"],
    },
  },
} as const
