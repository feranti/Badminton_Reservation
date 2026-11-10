// Types de la base, écrits à la main d'après supabase/migrations.
// Pour les régénérer : npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string; created_at: string };
        Insert: { id: string; display_name: string; created_at?: string };
        Update: { display_name?: string };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          venue: string;
          starts_at: string;
          ends_at: string;
          notes: string | null;
          created_by: string;
          created_at: string;
          reminder_sent_at: string | null;
        };
        Insert: {
          id?: string;
          venue: string;
          starts_at: string;
          ends_at: string;
          notes?: string | null;
          created_by?: string;
          reminder_sent_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["sessions"]["Insert"]>;
        Relationships: [];
      };
      court_bookings: {
        Row: {
          id: string;
          session_id: string;
          court: number;
          price_cents: number;
          booked_by: string;
          co_payer: string | null;
          starts_at: string;
          ends_at: string;
          created_by: string;
          created_at: string;
          card_pricing: boolean;
          booked_by_card: boolean;
          co_payer_card: boolean;
        };
        Insert: {
          id?: string;
          session_id: string;
          court: number;
          price_cents: number;
          booked_by: string;
          co_payer?: string | null;
          created_by?: string;
        };
        Update: {
          price_cents?: number;
          booked_by?: string;
          co_payer?: string | null;
          card_pricing?: boolean;
          booked_by_card?: boolean;
          co_payer_card?: boolean;
        };
        Relationships: [];
      };
      booking_qr_codes: {
        Row: { booking_id: string; hour: number; qr_path: string; created_at: string };
        Insert: { booking_id: string; hour: number; qr_path: string };
        Update: { qr_path?: string };
        Relationships: [];
      };
      session_participants: {
        Row: { session_id: string; player_id: string; added_at: string; guests: number };
        Insert: { session_id: string; player_id: string; guests?: number };
        Update: { guests?: number };
        Relationships: [];
      };
      session_events: {
        Row: {
          id: number;
          session_id: string;
          kind: string;
          actor_id: string | null;
          player_id: string | null;
          details: Json;
          created_at: string;
        };
        // L'appli n'écrit que les passages liste d'attente ↔ joueurs (le reste vient des déclencheurs).
        Insert: { session_id: string; kind: "promoted" | "demoted"; player_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          from_player: string;
          to_player: string;
          amount_cents: number;
          paid_on: string;
          note: string | null;
          confirmed_at: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          from_player: string;
          to_player: string;
          amount_cents: number;
          paid_on?: string;
          note?: string | null;
          confirmed_at?: string | null;
        };
        Update: { confirmed_at?: string | null };
        Relationships: [];
      };
    };
    Views: {
      session_players: {
        Row: {
          session_id: string;
          player_id: string;
          added_at: string;
          position: number;
          is_playing: boolean;
          capacity: number;
          guests: number;
          spots: number;
        };
        Relationships: [];
      };
      balances: {
        Row: { player_id: string; display_name: string; balance_cents: number };
        Relationships: [];
      };
    };
    Functions: {
      add_court_booking: {
        Args: {
          p_venue: string;
          p_court: number;
          p_starts_at: string;
          p_ends_at: string;
          p_price_cents: number;
          p_booked_by: string;
          p_co_payer?: string | null;
          p_card_pricing?: boolean;
          p_booked_by_card?: boolean;
          p_co_payer_card?: boolean;
        };
        Returns: string;
      };
      remove_court_booking: { Args: { p_booking: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
