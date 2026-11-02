import { DEFAULT_VENUE, sessionCapacity } from "@/lib/courts";
import type { Tables } from "@/lib/database.types";
import { requirePlayer } from "@/lib/session";

export type Player = Tables<"profiles">;
// Un QR code par heure de la réservation (hour = 0 pour la première heure).
export type BookingQr = { hour: number; path: string; url: string | null };
export type CourtBooking = Tables<"court_bookings"> & { qrs: BookingQr[] };
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
  const qrs = bookings.data.length
    ? await supabase.from("booking_qr_codes").select("booking_id, hour, qr_path").in("booking_id", bookings.data.map((b) => b.id)).order("hour")
    : { data: [], error: null };
  if (qrs.error) throw qrs.error;

  // Liens temporaires vers les QR codes (stockage privé), seulement quand la page les affiche.
  const urls = new Map<string, string>();
  const paths = qrs.data.map((q) => q.qr_path);
  if (qrUrls && paths.length > 0) {
    const { data } = await supabase.storage.from("qr-codes").createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  return sessions.map((s) => {
    const sessionBookings = bookings.data
      .filter((b) => b.session_id === s.id)
      .map((b) => ({
        ...b,
        qrs: qrs.data
          .filter((q) => q.booking_id === b.id)
          .map((q) => ({ hour: q.hour, path: q.qr_path, url: urls.get(q.qr_path) ?? null })),
      }));
    return {
      ...s,
      bookings: sessionBookings,
      players: players.data.filter((p) => p.session_id === s.id),
      capacity: sessionCapacity(sessionBookings),
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

// Gymnase par défaut d'une nouvelle réservation : repris de la dernière saisie.
export async function getLastVenue() {
  const { supabase } = await requirePlayer();
  const { data: session } = await supabase
    .from("sessions")
    .select("venue")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return session?.venue ?? DEFAULT_VENUE;
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
