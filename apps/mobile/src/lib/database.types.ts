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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ultron_conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          metadata: Json
          owner_id: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          metadata?: Json
          owner_id?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          metadata?: Json
          owner_id?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ultron_device_sync: {
        Row: {
          created_at: string
          device_key: string
          device_name: string | null
          id: string
          last_sync_at: string | null
          owner_id: string
          platform: string | null
          sync_cursor: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_key: string
          device_name?: string | null
          id?: string
          last_sync_at?: string | null
          owner_id?: string
          platform?: string | null
          sync_cursor?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_key?: string
          device_name?: string | null
          id?: string
          last_sync_at?: string | null
          owner_id?: string
          platform?: string | null
          sync_cursor?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ultron_document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string | null
          id: string
          metadata: Json
          owner_id: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          metadata?: Json
          owner_id?: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          metadata?: Json
          owner_id?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ultron_document_chunks_document_id_owner_id_fkey"
            columns: ["document_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ultron_documents"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      ultron_documents: {
        Row: {
          byte_size: number | null
          checksum_sha256: string | null
          created_at: string
          id: string
          metadata: Json
          mime_type: string | null
          name: string
          owner_id: string
          processing_status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          name: string
          owner_id?: string
          processing_status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          checksum_sha256?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          name?: string
          owner_id?: string
          processing_status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ultron_instance: {
        Row: {
          created_at: string
          display_name: string
          id: boolean
          owner_id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          id?: boolean
          owner_id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: boolean
          owner_id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ultron_memory_items: {
        Row: {
          archived_at: string | null
          confidence: number
          content: string
          created_at: string
          embedding: string | null
          embedding_model: string | null
          id: string
          importance: number
          last_accessed_at: string | null
          memory_type: string
          metadata: Json
          owner_id: string
          source: string | null
          source_ref: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          confidence?: number
          content: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          importance?: number
          last_accessed_at?: string | null
          memory_type: string
          metadata?: Json
          owner_id?: string
          source?: string | null
          source_ref?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          confidence?: number
          content?: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          id?: string
          importance?: number
          last_accessed_at?: string | null
          memory_type?: string
          metadata?: Json
          owner_id?: string
          source?: string | null
          source_ref?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ultron_memory_relations: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          owner_id: string
          relation_type: string
          source_memory_id: string
          target_memory_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          owner_id?: string
          relation_type: string
          source_memory_id: string
          target_memory_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          owner_id?: string
          relation_type?: string
          source_memory_id?: string
          target_memory_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "ultron_memory_relations_source_memory_id_owner_id_fkey"
            columns: ["source_memory_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ultron_memory_items"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "ultron_memory_relations_target_memory_id_owner_id_fkey"
            columns: ["target_memory_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ultron_memory_items"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      ultron_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          model_id: string | null
          owner_id: string
          parts: Json
          role: string
          sequence_no: number
          status: string
          token_count: number | null
          tool_name: string | null
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          model_id?: string | null
          owner_id?: string
          parts?: Json
          role: string
          sequence_no?: never
          status?: string
          token_count?: number | null
          tool_name?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          model_id?: string | null
          owner_id?: string
          parts?: Json
          role?: string
          sequence_no?: never
          status?: string
          token_count?: number | null
          tool_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ultron_messages_conversation_id_owner_id_fkey"
            columns: ["conversation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ultron_conversations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      ultron_model_profiles: {
        Row: {
          capabilities: Json
          config: Json
          context_window: number | null
          created_at: string
          credential_ref: string | null
          display_name: string
          endpoint_url: string | null
          id: string
          is_default: boolean
          is_enabled: boolean
          max_output_tokens: number | null
          model_id: string
          owner_id: string
          priority: number
          provider: string
          runtime_kind: string
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          config?: Json
          context_window?: number | null
          created_at?: string
          credential_ref?: string | null
          display_name: string
          endpoint_url?: string | null
          id?: string
          is_default?: boolean
          is_enabled?: boolean
          max_output_tokens?: number | null
          model_id: string
          owner_id?: string
          priority?: number
          provider: string
          runtime_kind: string
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          config?: Json
          context_window?: number | null
          created_at?: string
          credential_ref?: string | null
          display_name?: string
          endpoint_url?: string | null
          id?: string
          is_default?: boolean
          is_enabled?: boolean
          max_output_tokens?: number | null
          model_id?: string
          owner_id?: string
          priority?: number
          provider?: string
          runtime_kind?: string
          updated_at?: string
        }
        Relationships: []
      }
      ultron_settings: {
        Row: {
          owner_id: string
          setting_key: string
          setting_value: Json
          updated_at: string
        }
        Insert: {
          owner_id?: string
          setting_key: string
          setting_value?: Json
          updated_at?: string
        }
        Update: {
          owner_id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      ultron_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          error_message: string | null
          id: string
          metadata: Json
          owner_id: string
          priority: number
          result: Json | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          owner_id?: string
          priority?: number
          result?: Json | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          owner_id?: string
          priority?: number
          result?: Json | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ultron_tool_permissions: {
        Row: {
          access_mode: string
          created_at: string
          id: string
          owner_id: string
          require_confirmation: boolean
          scopes: Json
          tool_key: string
          updated_at: string
        }
        Insert: {
          access_mode?: string
          created_at?: string
          id?: string
          owner_id?: string
          require_confirmation?: boolean
          scopes?: Json
          tool_key: string
          updated_at?: string
        }
        Update: {
          access_mode?: string
          created_at?: string
          id?: string
          owner_id?: string
          require_confirmation?: boolean
          scopes?: Json
          tool_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ultron_tool_runs: {
        Row: {
          approved_at: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          input: Json
          metadata: Json
          output: Json | null
          owner_id: string
          requested_at: string
          status: string
          task_id: string | null
          tool_key: string
        }
        Insert: {
          approved_at?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          metadata?: Json
          output?: Json | null
          owner_id?: string
          requested_at?: string
          status?: string
          task_id?: string | null
          tool_key: string
        }
        Update: {
          approved_at?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          metadata?: Json
          output?: Json | null
          owner_id?: string
          requested_at?: string
          status?: string
          task_id?: string | null
          tool_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ultron_tool_runs_task_id_owner_id_fkey"
            columns: ["task_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "ultron_tasks"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
