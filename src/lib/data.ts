import type { Tables } from "@/lib/database.types";
import { requirePlayer } from "@/lib/session";

export type Player = Tables<"profiles">;
export type CourtBooking = Tables<"court_bookings">;
export type Session = Tables<"sessions"> & {
  courts: CourtBooking[];
  participantIds: string[];
  totalCents: number;
};

export async function getPlayers() {
  const { supabase } = await requirePlayer();
  const { data, error } = await supabase.from("profiles").select("*").order("display_name");
  if (error) throw error;
  return data;
}

async function withDetails(sessions: Tables<"sessions">[]): Promise<Session[]> {
  if (sessions.length === 0) return [];
  const { supabase } = await requirePlayer();
  const ids = sessions.map((s) => s.id);
  const [courts, participants] = await Promise.all([
    supabase.from("court_bookings").select("*").in("session_id", ids).order("court"),
    supabase.from("session_participants").select("session_id, player_id").in("session_id", ids).order("added_at"),
  ]);
  if (courts.error) throw courts.error;
  if (participants.error) throw participants.error;

  return sessions.map((s) => {
    const sessionCourts = courts.data.filter((c) => c.session_id === s.id);
    return {
      ...s,
      courts: sessionCourts,
      participantIds: participants.data.filter((p) => p.session_id === s.id).map((p) => p.player_id),
      totalCents: sessionCourts.reduce((sum, c) => sum + c.price_cents, 0),
    };
  });
}

// À venir : dans l'ordre chronologique. Passées : les plus récentes d'abord.
export async function getSessions(past: boolean) {
  const { supabase } = await requirePlayer();
  const now = new Date().toISOString();
  const query = supabase.from("sessions").select("*");
  const { data, error } = past
    ? await query.lt("ends_at", now).order("starts_at", { ascending: false }).limit(50)
    : await query.gte("ends_at", now).order("starts_at");
  if (error) throw error;
  return withDetails(data);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSession(id: string) {
  if (!UUID.test(id)) return null;
  const { supabase } = await requirePlayer();
  const { data, error } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [session] = await withDetails([data]);
  return session;
}

// Valeurs par défaut d'une nouvelle soirée : reprises de la dernière saisie.
export async function getLastDefaults() {
  const { supabase } = await requirePlayer();
  const [{ data: session }, { data: court }] = await Promise.all([
    supabase.from("sessions").select("venue").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("court_bookings").select("price_cents").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { venue: session?.venue ?? "", priceCents: court?.price_cents ?? null };
}

export async function getBalances() {
  const { supabase } = await requirePlayer();
  const { data, error } = await supabase.from("balances").select("*").order("balance_cents", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getPayments() {
  const { supabase } = await requirePlayer();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}
