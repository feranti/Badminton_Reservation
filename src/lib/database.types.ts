// Types de la base, écrits à la main d'après supabase/migrations.
// Pour les régénérer : npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

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
        };
        Insert: {
          id?: string;
          venue: string;
          starts_at: string;
          ends_at: string;
          notes?: string | null;
          created_by?: string;
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
          qr_path: string | null;
          created_by: string;
          created_at: string;
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
        Update: { qr_path?: string | null };
        Relationships: [];
      };
      session_participants: {
        Row: { session_id: string; player_id: string; added_at: string; guests: number };
        Insert: { session_id: string; player_id: string; guests?: number };
        Update: { guests?: number };
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
