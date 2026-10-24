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
        Update: { court?: number; price_cents?: number; booked_by?: string; co_payer?: string | null };
        Relationships: [];
      };
      session_participants: {
        Row: { session_id: string; player_id: string; added_at: string };
        Insert: { session_id: string; player_id: string };
        Update: never;
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
      balances: {
        Row: { player_id: string; display_name: string; balance_cents: number };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
