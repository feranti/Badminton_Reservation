import { DEFAULT_VENUE, sessionCapacity } from "@/lib/courts";
import type { Tables, Views } from "@/lib/database.types";
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
  const { db } = await requirePlayer();
  return db<Player>`select * from public.profiles order by display_name`;
}

async function withDetails(sessions: Tables<"sessions">[], { qrUrls = false } = {}): Promise<Session[]> {
  if (sessions.length === 0) return [];
  const { supabase, db } = await requirePlayer();
  const ids = sessions.map((s) => s.id);
  // Les trois lectures dans la même transaction : un seul passage par la base.
  const { bookings, players, qrs } = await db.tx(async (tx) => {
    const [bookings, players] = await Promise.all([
      tx<Tables<"court_bookings">[]>`
        select * from public.court_bookings
        where session_id = any(${ids}::uuid[]) and cancelled_at is null
        order by court, starts_at`,
      tx<(SessionPlayer & { session_id: string })[]>`
        select session_id, player_id, position, is_playing, guests, spots from public.session_players
        where session_id = any(${ids}::uuid[])
        order by position`,
    ]);
    const qrs = bookings.length
      ? await tx<{ booking_id: string; hour: number; qr_path: string }[]>`
          select booking_id, hour, qr_path from public.booking_qr_codes
          where booking_id = any(${bookings.map((b) => b.id)}::uuid[]) and removed_at is null
          order by hour`
      : [];
    return { bookings, players, qrs };
  });

  // Liens temporaires vers les QR codes (stockage privé), seulement quand la page les affiche.
  const urls = new Map<string, string>();
  const paths = qrs.map((q) => q.qr_path);
  if (qrUrls && paths.length > 0) {
    const { data } = await supabase.storage.from("qr-codes").createSignedUrls(paths, 60 * 60);
    for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  return sessions.map((s) => {
    const sessionBookings = bookings
      .filter((b) => b.session_id === s.id)
      .map((b) => ({
        ...b,
        qrs: qrs
          .filter((q) => q.booking_id === b.id)
          .map((q) => ({ hour: q.hour, path: q.qr_path, url: urls.get(q.qr_path) ?? null })),
      }));
    return {
      ...s,
      bookings: sessionBookings,
      players: players
        .filter((p) => p.session_id === s.id)
        .map(({ player_id, position, is_playing, guests, spots }) => ({ player_id, position, is_playing, guests, spots })),
      capacity: sessionCapacity(sessionBookings),
      totalCents: sessionBookings.reduce((sum, b) => sum + b.price_cents, 0),
    };
  });
}

// À venir : dans l'ordre chronologique. Passées : les plus récentes d'abord.
export async function getSessions(past: boolean) {
  const { db } = await requirePlayer();
  const now = new Date().toISOString();
  const sessions = past
    ? await db<Tables<"sessions">>`
        select * from public.sessions where cancelled_at is null and ends_at < ${now}
        order by starts_at desc limit 50`
    : await db<Tables<"sessions">>`
        select * from public.sessions where cancelled_at is null and ends_at >= ${now}
        order by starts_at`;
  return withDetails(sessions);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// cancelled : renvoie aussi une session annulée, pour la consulter (page de la session, historique).
export async function getSession(id: string, { cancelled = false } = {}) {
  if (!UUID.test(id)) return null;
  const { db } = await requirePlayer();
  const [data] = await db<Tables<"sessions">>`
    select * from public.sessions where id = ${id} and (${cancelled} or cancelled_at is null)`;
  if (!data) return null;
  const [session] = await withDetails([data], { qrUrls: true });
  return session;
}

// Gymnase par défaut d'une nouvelle réservation : repris de la dernière saisie.
export async function getLastVenue() {
  const { db } = await requirePlayer();
  const [session] = await db<{ venue: string }>`
    select venue from public.sessions where cancelled_at is null order by created_at desc limit 1`;
  return session?.venue ?? DEFAULT_VENUE;
}

export async function getBalances() {
  const { db } = await requirePlayer();
  return db<Views<"balances">>`select * from public.balances order by balance_cents desc`;
}

export async function getPayments() {
  const { db } = await requirePlayer();
  return db<Tables<"payments">>`
    select * from public.payments where cancelled_at is null order by created_at desc limit 100`;
}

export function isPast(session: { ends_at: string }) {
  return Date.parse(session.ends_at) < Date.now();
}

export type SessionEvent = Tables<"session_events">;

// Historique d'une session, du plus récent au plus ancien, avec le nombre total d'événements.
export async function getSessionEvents(sessionId: string, limit?: number) {
  const { db } = await requirePlayer();
  if (!UUID.test(sessionId)) return { events: [], count: 0 };
  const rows = await db<SessionEvent & { total: number }>`
    select *, count(*) over () as total from public.session_events
    where session_id = ${sessionId}
    order by created_at desc, id desc
    limit ${limit ?? null}`;
  return { events: rows as SessionEvent[], count: rows[0]?.total ?? 0 };
}
