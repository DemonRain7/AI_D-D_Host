export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      worlds: {
        Row: {
          id: string
          name: string
          tone: string | null
          setting: string
          description: string
          starter: string | null
          embedding: number[] | null
          image_url: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          tone?: string | null
          setting: string
          description: string
          starter?: string | null
          embedding?: number[] | null
          image_url?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          tone?: string | null
          setting?: string
          description?: string
          starter?: string | null
          embedding?: number[] | null
          image_url?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      sessions: {
        Row: {
          id: string
          world_id: string
          title: string
          started_at: string
          ended_at: string | null
          current_story_node_id: string | null
          story_state: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          world_id: string
          title: string
          started_at?: string
          ended_at?: string | null
          current_story_node_id?: string | null
          story_state?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          world_id?: string
          title?: string
          started_at?: string
          ended_at?: string | null
          current_story_node_id?: string | null
          story_state?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      players: {
        Row: {
          id: string
          session_id: string
          name: string
          appearance: string
          state: string | null
          dynamic_fields: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          session_id: string
          name: string
          appearance: string
          state?: string | null
          dynamic_fields?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          name?: string
          appearance?: string
          state?: string | null
          dynamic_fields?: Json
          created_at?: string
          updated_at?: string
        }
      }
      session_messages: {
        Row: {
          id: string
          session_id: string
          author: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          author: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          author?: string
          content?: string
          created_at?: string
        }
      }
      world_player_fields: {
        Row: {
          id: string
          world_id: string
          field_name: string
          field_type: 'number' | 'text'
          is_hidden: boolean
          display_order: number
          default_value: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          world_id: string
          field_name: string
          field_type: 'number' | 'text'
          is_hidden?: boolean
          display_order?: number
          default_value?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          world_id?: string
          field_name?: string
          field_type?: 'number' | 'text'
          is_hidden?: boolean
          display_order?: number
          default_value?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      locations: {
        Row: {
          id: string
          world_id: string
          name: string
          aliases: string[]
          description: string
          embedding: number[] | null
          parent_location_id: string | null
          path: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          world_id: string
          name: string
          aliases?: string[]
          description: string
          embedding?: number[] | null
          parent_location_id?: string | null
          path?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          world_id?: string
          name?: string
          aliases?: string[]
          description?: string
          embedding?: number[] | null
          parent_location_id?: string | null
          path?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      story_nodes: {
        Row: {
          id: string
          world_id: string
          name: string
          aliases: string[]
          description: string
          embedding: number[] | null
          trigger_conditions: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          world_id: string
          name: string
          aliases?: string[]
          description: string
          embedding?: number[] | null
          trigger_conditions?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          world_id?: string
          name?: string
          aliases?: string[]
          description?: string
          embedding?: number[] | null
          trigger_conditions?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      story_edges: {
        Row: {
          id: string
          world_id: string
          from_node_id: string
          to_node_id: string
          label: string | null
          priority: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          world_id: string
          from_node_id: string
          to_node_id: string
          label?: string | null
          priority?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          world_id?: string
          from_node_id?: string
          to_node_id?: string
          label?: string | null
          priority?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}
