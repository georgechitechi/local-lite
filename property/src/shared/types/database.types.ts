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
      api_keys: {
        Row: {
          business_id: string
          created_at: string | null
          deleted: boolean | null
          encrypted_key: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          metadata: Json | null
          name: string
          scopes: Json | null
          updated_at: string | null
        }
        Insert: {
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          encrypted_key: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          metadata?: Json | null
          name: string
          scopes?: Json | null
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          encrypted_key?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          metadata?: Json | null
          name?: string
          scopes?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          business_id: string | null
          changes: Json | null
          created_at: string | null
          deleted: boolean | null
          entity_id: string
          entity_type: string
          id: string
          label: string | null
          metadata: Json | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          business_id?: string | null
          changes?: Json | null
          created_at?: string | null
          deleted?: boolean | null
          entity_id: string
          entity_type: string
          id?: string
          label?: string | null
          metadata?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          business_id?: string | null
          changes?: Json | null
          created_at?: string | null
          deleted?: boolean | null
          entity_id?: string
          entity_type?: string
          id?: string
          label?: string | null
          metadata?: Json | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      backup_logs: {
        Row: {
          backup_completed_at: string | null
          backup_started_at: string | null
          backup_status: string
          business_id: string
          created_at: string | null
          deleted: boolean | null
          error_details: Json | null
          error_message: string | null
          file_name: string | null
          file_size: number | null
          id: string
          storage_path: string | null
          storage_url: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          backup_completed_at?: string | null
          backup_started_at?: string | null
          backup_status: string
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          error_details?: Json | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          storage_path?: string | null
          storage_url?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          backup_completed_at?: string | null
          backup_started_at?: string | null
          backup_status?: string
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          error_details?: Json | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          id?: string
          storage_path?: string | null
          storage_url?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "backup_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address: string | null
          business_id: string | null
          converted_tenant_id: string | null
          created_at: string | null
          deleted: boolean | null
          documents: Json | null
          email: string | null
          gender: string | null
          house_id: string | null
          id: string
          marital_status: string | null
          metadata: Json | null
          name: string
          nationality: string | null
          next_of_kin: Json | null
          payment_details: Json | null
          phone: string | null
          property_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          business_id?: string | null
          converted_tenant_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          documents?: Json | null
          email?: string | null
          gender?: string | null
          house_id?: string | null
          id?: string
          marital_status?: string | null
          metadata?: Json | null
          name: string
          nationality?: string | null
          next_of_kin?: Json | null
          payment_details?: Json | null
          phone?: string | null
          property_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          business_id?: string | null
          converted_tenant_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          documents?: Json | null
          email?: string | null
          gender?: string | null
          house_id?: string | null
          id?: string
          marital_status?: string | null
          metadata?: Json | null
          name?: string
          nationality?: string | null
          next_of_kin?: Json | null
          payment_details?: Json | null
          phone?: string | null
          property_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_converted_tenant_id_fkey"
            columns: ["converted_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      business_shares: {
        Row: {
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          id: string
          metadata: Json | null
          roles: string[] | null
          shared_with: string
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          roles?: string[] | null
          shared_with: string
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          roles?: string[] | null
          shared_with?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_shares_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string
          created_at: string | null
          deleted: boolean | null
          email: string
          id: string
          is_system: boolean | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          metadata: Json | null
          name: string
          phone: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address: string
          created_at?: string | null
          deleted?: boolean | null
          email: string
          id?: string
          is_system?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          metadata?: Json | null
          name: string
          phone: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string
          created_at?: string | null
          deleted?: boolean | null
          email?: string
          id?: string
          is_system?: boolean | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          metadata?: Json | null
          name?: string
          phone?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      contracts: {
        Row: {
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          documents: string[] | null
          end_date: string
          house_id: string | null
          id: string
          metadata: Json | null
          remarks: string | null
          renewal_reminder_sent_at: string | null
          rent_amount: number
          start_date: string
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          documents?: string[] | null
          end_date: string
          house_id?: string | null
          id?: string
          metadata?: Json | null
          remarks?: string | null
          renewal_reminder_sent_at?: string | null
          rent_amount: number
          start_date: string
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          documents?: string[] | null
          end_date?: string
          house_id?: string | null
          id?: string
          metadata?: Json | null
          remarks?: string | null
          renewal_reminder_sent_at?: string | null
          rent_amount?: number
          start_date?: string
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          business_id: string | null
          category: string
          created_at: string | null
          date: string
          deleted: boolean | null
          id: string
          metadata: Json | null
          remarks: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          business_id?: string | null
          category: string
          created_at?: string | null
          date: string
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          remarks?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          business_id?: string | null
          category?: string
          created_at?: string | null
          date?: string
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          remarks?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_images: {
        Row: {
          business_id: string
          created_at: string | null
          deleted: boolean | null
          id: string
          name: string
          updated_at: string | null
          url: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          name: string
          updated_at?: string | null
          url: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          name?: string
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "gallery_images_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      houses: {
        Row: {
          amenities: Json | null
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          house_number: string
          id: string
          is_serviceable: boolean | null
          metadata: Json | null
          monthly_rent: number
          photos: string[] | null
          property_id: string | null
          status: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amenities?: Json | null
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          house_number: string
          id?: string
          is_serviceable?: boolean | null
          metadata?: Json | null
          monthly_rent: number
          photos?: string[] | null
          property_id?: string | null
          status?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amenities?: Json | null
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          house_number?: string
          id?: string
          is_serviceable?: boolean | null
          metadata?: Json | null
          monthly_rent?: number
          photos?: string[] | null
          property_id?: string | null
          status?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "houses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "houses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_requests: {
        Row: {
          affected_houses: string[] | null
          business_id: string
          created_at: string | null
          deleted: boolean | null
          description: string | null
          event_date: string | null
          expense_id: string | null
          house_id: string | null
          id: string
          images: string[] | null
          metadata: Json | null
          priority: string
          property_id: string | null
          status: string
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          affected_houses?: string[] | null
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          description?: string | null
          event_date?: string | null
          expense_id?: string | null
          house_id?: string | null
          id?: string
          images?: string[] | null
          metadata?: Json | null
          priority?: string
          property_id?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          affected_houses?: string[] | null
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          description?: string | null
          event_date?: string | null
          expense_id?: string | null
          house_id?: string | null
          id?: string
          images?: string[] | null
          metadata?: Json | null
          priority?: string
          property_id?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          business_id: string
          channel: string
          content: string
          created_at: string | null
          deleted: boolean | null
          id: string
          is_html: boolean | null
          metadata: Json | null
          name: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          channel: string
          content: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          is_html?: boolean | null
          metadata?: Json | null
          name: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          channel?: string
          content?: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          is_html?: boolean | null
          metadata?: Json | null
          name?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_message_receipts: {
        Row: {
          business_id: string
          created_at: string | null
          deleted: boolean | null
          id: string
          payment_message_id: string
          receipt_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          payment_message_id: string
          receipt_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          payment_message_id?: string
          receipt_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_message_receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_message_receipts_payment_message_id_fkey"
            columns: ["payment_message_id"]
            isOneToOne: false
            referencedRelation: "payment_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_message_receipts_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_messages: {
        Row: {
          business_id: string
          created_at: string | null
          deleted: boolean | null
          id: string
          message_content: string
          metadata: Json | null
          transaction_date: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          message_content: string
          metadata?: Json | null
          transaction_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          message_content?: string
          metadata?: Json | null
          transaction_date?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          deleted: boolean | null
          email: string | null
          id: string
          metadata: Json | null
          name: string | null
          phone: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          deleted?: boolean | null
          email?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          deleted?: boolean | null
          email?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          phone?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      promotions: {
        Row: {
          amount: number | null
          business_id: string
          code: string
          created_at: string | null
          deleted: boolean | null
          description: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          property_id: string | null
          scope: string | null
          tenant_id: string | null
          type: string | null
          updated_at: string | null
          user_id: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          amount?: number | null
          business_id: string
          code: string
          created_at?: string | null
          deleted?: boolean | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          property_id?: string | null
          scope?: string | null
          tenant_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          amount?: number | null
          business_id?: string
          code?: string
          created_at?: string | null
          deleted?: boolean | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          property_id?: string | null
          scope?: string | null
          tenant_id?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          id: string
          latitude: number | null
          location: string
          longitude: number | null
          metadata: Json | null
          name: string
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          latitude?: number | null
          location: string
          longitude?: number | null
          metadata?: Json | null
          name: string
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          latitude?: number | null
          location?: string
          longitude?: number | null
          metadata?: Json | null
          name?: string
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_refunds: {
        Row: {
          amount: number
          business_id: string
          created_at: string | null
          deleted: boolean | null
          id: string
          metadata: Json | null
          reason: string | null
          receipt_id: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          receipt_id: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          receipt_id?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_refunds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_refunds_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          amount: number
          business_id: string | null
          contract_id: string | null
          created_at: string | null
          deleted: boolean | null
          id: string
          is_refunded: boolean
          metadata: Json | null
          notes: string | null
          payment_date: string
          payment_method: string
          payment_period: Json
          promotion_id: string | null
          refund_reason: string | null
          refunded_amount: number
          refunded_at: string | null
          refunded_by: string | null
          status: string
          tenant_id: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          business_id?: string | null
          contract_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          is_refunded?: boolean
          metadata?: Json | null
          notes?: string | null
          payment_date: string
          payment_method: string
          payment_period: Json
          promotion_id?: string | null
          refund_reason?: string | null
          refunded_amount?: number
          refunded_at?: string | null
          refunded_by?: string | null
          status: string
          tenant_id?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          business_id?: string | null
          contract_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          is_refunded?: boolean
          metadata?: Json | null
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_period?: Json
          promotion_id?: string | null
          refund_reason?: string | null
          refunded_amount?: number
          refunded_at?: string | null
          refunded_by?: string | null
          status?: string
          tenant_id?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_logs: {
        Row: {
          business_id: string | null
          channel: string
          contract_id: string | null
          created_at: string | null
          deleted: boolean | null
          id: string
          message: string | null
          metadata: Json | null
          reminder_type: string
          sent_at: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          channel: string
          contract_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          message?: string | null
          metadata?: Json | null
          reminder_type: string
          sent_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          channel?: string
          contract_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          message?: string | null
          metadata?: Json | null
          reminder_type?: string
          sent_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_logs_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          business_id: string
          created_at: string | null
          deleted: boolean | null
          emails: Json
          id: string
          last_run: string | null
          metadata: Json | null
          next_run: string
          schedule: Json
          schedule_type: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string | null
          deleted?: boolean | null
          emails?: Json
          id?: string
          last_run?: string | null
          metadata?: Json | null
          next_run?: string
          schedule?: Json
          schedule_type: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          deleted?: boolean | null
          emails?: Json
          id?: string
          last_run?: string | null
          metadata?: Json | null
          next_run?: string
          schedule?: Json
          schedule_type?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          id: string
          metadata: Json | null
          setting_key: string
          setting_value: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          setting_key: string
          setting_value: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          email: string | null
          gender: string | null
          id: string
          marital_status: string | null
          metadata: Json | null
          name: string
          nationality: string | null
          next_of_kin: Json | null
          phone: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          email?: string | null
          gender?: string | null
          id?: string
          marital_status?: string | null
          metadata?: Json | null
          name: string
          nationality?: string | null
          next_of_kin?: Json | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          email?: string | null
          gender?: string | null
          id?: string
          marital_status?: string | null
          metadata?: Json | null
          name?: string
          nationality?: string | null
          next_of_kin?: Json | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          business_id: string | null
          created_at: string | null
          deleted: boolean | null
          id: string
          metadata: Json | null
          token: string
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          token: string
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string | null
          deleted?: boolean | null
          id?: string
          metadata?: Json | null
          token?: string
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tokens_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      totp_secrets: {
        Row: {
          backup_codes: string[] | null
          created_at: string | null
          deleted: boolean | null
          email: string
          id: string
          is_enabled: boolean
          is_verified: boolean
          last_used_at: string | null
          secret: string
          updated_at: string | null
        }
        Insert: {
          backup_codes?: string[] | null
          created_at?: string | null
          deleted?: boolean | null
          email: string
          id?: string
          is_enabled?: boolean
          is_verified?: boolean
          last_used_at?: string | null
          secret: string
          updated_at?: string | null
        }
        Update: {
          backup_codes?: string[] | null
          created_at?: string | null
          deleted?: boolean | null
          email?: string
          id?: string
          is_enabled?: boolean
          is_verified?: boolean
          last_used_at?: string | null
          secret?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number | null
          business_id: string | null
          contract_id: string | null
          created_at: string | null
          currency: string | null
          deleted: boolean | null
          id: string
          is_success: boolean
          phone_number: string | null
          provider: string
          provider_reference: string | null
          raw_payload: Json | null
          status: string
          tenant_id: string | null
          transaction_reference: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          business_id?: string | null
          contract_id?: string | null
          created_at?: string | null
          currency?: string | null
          deleted?: boolean | null
          id?: string
          is_success?: boolean
          phone_number?: string | null
          provider: string
          provider_reference?: string | null
          raw_payload?: Json | null
          status: string
          tenant_id?: string | null
          transaction_reference?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          business_id?: string | null
          contract_id?: string | null
          created_at?: string | null
          currency?: string | null
          deleted?: boolean | null
          id?: string
          is_success?: boolean
          phone_number?: string | null
          provider?: string
          provider_reference?: string | null
          raw_payload?: Json | null
          status?: string
          tenant_id?: string | null
          transaction_reference?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bulk_restore_data: {
        Args: { p_data: Json; p_table_name: string }
        Returns: Json
      }
      calculate_next_run_time: {
        Args: { p_last_run?: string; p_schedule: Json }
        Returns: string
      }
      check_booking_existence: {
        Args: { p_business_id?: string; p_email: string; p_phone?: string }
        Returns: Json
      }
      check_business_access: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      create_contract_renewal_token: {
        Args: { p_contract_id: string; p_expires_hours?: number }
        Returns: string
      }
      create_cron_job: {
        Args: {
          p_command: string
          p_database?: string
          p_job_name: string
          p_schedule: string
          p_username?: string
        }
        Returns: Json
      }
      create_default_business_settings: {
        Args: {
          p_business_id?: string
          p_skip_existing?: boolean
          p_user_id?: string
        }
        Returns: undefined
      }
      create_info_request_token: {
        Args: { p_expires_hours?: number; p_tenant_id: string }
        Returns: string
      }
      create_scheduled_job_with_url: {
        Args: {
          p_function_name: string
          p_job_name: string
          p_payload?: Json
          p_schedule: string
          p_supabase_url: string
        }
        Returns: Json
      }
      create_storage_policies: {
        Args: { bucket_name: string }
        Returns: undefined
      }
      create_totp_secret: {
        Args: { p_email: string; p_secret: string }
        Returns: {
          backup_codes: string[]
          qr_code_url: string
          secret: string
        }[]
      }
      delete_all_businesses: { Args: never; Returns: undefined }
      delete_business_data: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      disable_totp: { Args: { p_email: string }; Returns: boolean }
      drop_storage_policies: { Args: never; Returns: undefined }
      enqueue_batch_items: {
        Args: { delay_seconds?: number; payloads: Json[]; queue_name: string }
        Returns: number[]
      }
      enqueue_bulk_message: {
        Args: { delay_seconds?: number; payload: Json }
        Returns: number
      }
      ensure_default_business: { Args: never; Returns: string }
      find_expiring_contracts: {
        Args: { p_days_before_expiry?: number }
        Returns: {
          contract_id: string
          days_until_expiry: number
          end_date: string
          house_number: string
          property_name: string
          rent_amount: number
          tenant_email: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      find_tenants_with_missing_info: {
        Args: never
        Returns: {
          business_name: string
          missing_fields: string[]
          tenant_email: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      fn_find_duplicates: {
        Args: { p_column_name: string; p_table_name: string }
        Returns: Json[]
      }
      generate_api_key: {
        Args: {
          p_business_id: string
          p_expires_at?: string
          p_name: string
          p_scopes?: Json
        }
        Returns: Json
      }
      generate_backup_codes: { Args: never; Returns: string[] }
      get_cron_job: { Args: { p_job_name: string }; Returns: Json }
      get_cron_job_history: {
        Args: { p_job_name?: string; p_limit?: number }
        Returns: {
          command: string
          database: string
          end_time: string
          job_id: number
          job_name: string
          return_message: string
          run_id: number
          start_time: string
          status: string
          username: string
        }[]
      }
      get_pending_queue_jobs: {
        Args: { limit_count?: number; queue_name: string }
        Returns: {
          enqueued_at: string
          message: Json
          msg_id: number
          vt: string
        }[]
      }
      get_pending_rent_for_date: {
        Args: { target_business_id: string; target_date: string }
        Returns: {
          amount_paid: number
          amount_pending: number
          business_id: string
          contract_amount: number
          contract_end_date: string
          contract_id: string
          contract_start_date: string
          house_number: string
          payment_status: string
          property_name: string
          target_month: number
          target_year: number
          tenant_email: string
          tenant_id: string
          tenant_name: string
          tenant_phone: string
        }[]
      }
      get_table_columns: {
        Args: { table_name: string }
        Returns: {
          column_default: string
          column_name: string
          data_type: string
          is_nullable: string
        }[]
      }
      get_totp_status: {
        Args: { p_email: string }
        Returns: {
          backup_codes_count: number
          is_enabled: boolean
          is_verified: boolean
          last_used_at: string
        }[]
      }
      get_user_by_email: { Args: { user_email: string }; Returns: Json }
      handle_times_triggers: { Args: never; Returns: string[] }
      has_renewal_contract: {
        Args: { check_tenant_id: string }
        Returns: boolean
      }
      initialize_missing_business_settings: {
        Args: never
        Returns: {
          business_id: string
          business_name: string
          message: string
          settings_created: number
        }[]
      }
      list_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          command: string
          database: string
          job_id: number
          job_name: string
          nodename: string
          nodeport: number
          schedule: string
          username: string
        }[]
      }
      list_tables: {
        Args: never
        Returns: {
          table_name: string
        }[]
      }
      manage_queue_job: {
        Args: { action_type: string; message_id: number; queue_name: string }
        Returns: boolean
      }
      mark_expired_contracts: { Args: never; Returns: number }
      remove_cron_job: { Args: { p_job_name: string }; Returns: Json }
      remove_jsonb_key_from_all_tables: {
        Args: { key_to_remove: string; target_column: string }
        Returns: undefined
      }
      renew_contract: {
        Args: {
          p_new_end_date: string
          p_new_rent_amount?: number
          p_token: string
        }
        Returns: Json
      }
      reveal_api_key: { Args: { p_key_id: string }; Returns: string }
      seed_all_businesses_with_defaults: {
        Args: never
        Returns: {
          business_id: string
          business_name: string
          message: string
          settings_created: number
        }[]
      }
      seed_default_message_templates: {
        Args: { p_business_id: string; p_user_id: string }
        Returns: undefined
      }
      set_all_triggers_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      set_realtime_enabled: { Args: { p_enabled: boolean }; Returns: undefined }
      set_rls_enabled: { Args: { p_enabled: boolean }; Returns: undefined }
      submit_booking_request: {
        Args: {
          p_address?: string
          p_business_id?: string
          p_email: string
          p_gender?: string
          p_house_id?: string
          p_marital_status?: string
          p_name: string
          p_nationality?: string
          p_next_of_kin?: Json
          p_phone: string
          p_property_id?: string
        }
        Returns: Json
      }
      truncate_all_tables: { Args: never; Returns: undefined }
      update_all_next_backup_times: { Args: never; Returns: string }
      update_cron_job: {
        Args: {
          p_job_name: string
          p_new_command?: string
          p_new_schedule?: string
        }
        Returns: Json
      }
      use_backup_code: {
        Args: {
          p_backup_code: string
          p_email: string
          p_ip_address?: unknown
          p_user_agent?: string
        }
        Returns: boolean
      }
      validate_renewal_token: {
        Args: { p_token: string }
        Returns: {
          contract_id: string
          end_date: string
          house_number: string
          is_valid: boolean
          property_name: string
          rent_amount: number
          tenant_email: string
          tenant_id: string
          tenant_name: string
        }[]
      }
      verify_api_key: { Args: { p_api_key: string }; Returns: Json }
      verify_totp_code: {
        Args: {
          p_code: string
          p_email: string
          p_ip_address?: unknown
          p_user_agent?: string
        }
        Returns: boolean
      }
      verify_totp_setup: {
        Args: { p_code: string; p_email: string }
        Returns: boolean
      }
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
