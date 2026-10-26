import { DEFAULT_VENUE } from "@/lib/courts";
import type { Tables } from "@/lib/database.types";
import { requirePlayer } from "@/lib/session";

export type Player = Tables<"profiles">;
export type CourtBooking = Tables<"court_bookings"> & { qrUrl: string | null };
// guests = invités extérieurs amenés par le joueur ; spots = places prises (lui compris).
export type SessionPlayer = { player_id: string; position: number; is_playing: boolean; guests: number; spots: number };
export type Session = Tables<"sessions"> & {
  bookings: CourtBooking[];
  players: SessionPlayer[];
  capacity: number;
  totalCents: number;
};

export async function getPlayers() {
  const { supabase } = await requirePlayer();
  const { data, error } = await supabase.from("profiles").select("*").order("display_name");
  if (error) throw error;
  return data;
}

async function withDetails(sessions: Tables<"sessions">[], { qrUrls = false } = {}): Promise<Session[]> {
  if (sessions.length === 0) return [];
  const { supabase } = await requirePlayer();
  const ids = sessions.map((s) => s.id);
  const [bookings, players] = await Promise.all([
    supabase.from("court_bookings").select("*").in("session_id", ids).order("court").order("starts_at"),
    supabase.from("session_players").select("session_id, player_id, position, is_playing, guests, spots").in("session_id", ids).order("position"),
  ]);
  if (bookings.error) throw bookings.error;
  if (players.error) throw players.error;

  // Liens temporaires vers les QR codes (stockage privé), seulement quand la page les affiche.
  const urls = new Map<string, string>();
  const paths = bookings.data.map((b) => b.qr_path).filter((p): p is string => Boolean(p));
  if (qrUrls && paths.length > 0) {
    const { data } = await supabase.storage.from("qr-codes").createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  return sessions.map((s) => {
    const sessionBookings = bookings.data
      .filter((b) => b.session_id === s.id)
      .map((b) => ({ ...b, qrUrl: b.qr_path ? (urls.get(b.qr_path) ?? null) : null }));
    return {
      ...s,
      bookings: sessionBookings,
      players: players.data.filter((p) => p.session_id === s.id),
      capacity: 4 * new Set(sessionBookings.map((b) => b.court)).size,
      totalCents: sessionBookings.reduce((sum, b) => sum + b.price_cents, 0),
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
  const [session] = await withDetails([data], { qrUrls: true });
  return session;
}

// Valeurs par défaut d'une nouvelle réservation : reprises de la dernière saisie.
export async function getLastDefaults() {
  const { supabase } = await requirePlayer();
  const [{ data: session }, { data: court }] = await Promise.all([
    supabase.from("sessions").select("venue").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("court_bookings").select("price_cents").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { venue: session?.venue ?? DEFAULT_VENUE, priceCents: court?.price_cents ?? null };
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

export function isPast(session: { ends_at: string }) {
  return Date.parse(session.ends_at) < Date.now();
}
