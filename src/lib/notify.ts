import { headers } from "next/headers";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAYERS_PER_COURT, sessionCapacity } from "@/lib/courts";
import type { Database } from "@/lib/database.types";
import { formatDay, formatSlot, formatTime, formatTimes } from "@/lib/format";
import { sendMail } from "@/lib/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToGroup } from "@/lib/whatsapp";

type Client = SupabaseClient<Database>;

export type Snapshot = { registered: Set<string>; playing: Set<string> };

// Inscrits et joueurs effectifs (hors liste d'attente) d'une session, à un instant donné.
export async function snapshot(supabase: Client, sessionId: string): Promise<Snapshot> {
  const { data } = await supabase.from("session_players").select("player_id, is_playing").eq("session_id", sessionId);
  return {
    registered: new Set((data ?? []).map((p) => p.player_id)),
    playing: new Set((data ?? []).filter((p) => p.is_playing).map((p) => p.player_id)),
  };
}

// Adresse complète de la page d'une session, d'après la requête en cours.
async function sessionLink(sessionId: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}/sessions/${sessionId}` : "";
}

// Note dans l'historique de la session les joueurs passés de la liste d'attente aux joueurs
// effectifs, ou l'inverse (terrain retiré). Renvoie l'état après le changement.
async function logWaitingChanges(supabase: Client, sessionId: string, before: Snapshot) {
  const after = await snapshot(supabase, sessionId);
  const stayed = [...after.registered].filter((id) => before.registered.has(id));
  const events = [
    ...stayed.filter((id) => after.playing.has(id) && !before.playing.has(id)).map((player_id) => ({ player_id, kind: "promoted" as const })),
    ...stayed.filter((id) => !after.playing.has(id) && before.playing.has(id)).map((player_id) => ({ player_id, kind: "demoted" as const })),
  ];
  if (events.length) {
    const { error } = await supabase.from("session_events").insert(events.map((e) => ({ ...e, session_id: sessionId })));
    if (error) console.error("[historique] liste d'attente non notée", error);
  }
  return after;
}

// Note dans l'historique les passages liste d'attente ↔ joueurs, et prévient par e-mail les joueurs
// qui viennent de passer de la liste d'attente aux joueurs effectifs.
// N'interrompt jamais l'action en cours : une erreur d'envoi est seulement journalisée.
export async function notifyPromotions(supabase: Client, sessionId: string, before: Snapshot, actorId: string) {
  try {
    const after = await logWaitingChanges(supabase, sessionId, before);
    // Promus = étaient inscrits mais en liste d'attente, et jouent maintenant.
    const waiting = [...after.playing]
      .filter((id) => before.registered.has(id) && !before.playing.has(id) && id !== actorId)
      .map((player_id) => ({ player_id }));
    if (waiting.length === 0) return;
    const { data: session } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
    if (!session) return;

    const admin = createAdminClient();
    if (!admin) {
      console.info(`[liste d'attente] ${waiting.length} joueur(s) promu(s), clé SUPABASE_SECRET_KEY absente : pas d'e-mail.`);
      return;
    }
    const link = await sessionLink(sessionId);
    const slot = formatSlot(session.starts_at, session.ends_at);

    for (const { player_id } of waiting) {
      const { data } = await admin.auth.admin.getUserById(player_id);
      const email = data.user?.email;
      if (!email) continue;
      await sendMail({
        to: email,
        subject: `Une place s'est libérée : vous jouez ${slot.toLowerCase()}`,
        text:
          `Bonne nouvelle ! Une place s'est libérée et vous passez de la liste d'attente aux joueurs de la session :\n\n` +
          `${slot}\n${session.venue}\n\n` +
          (link ? `Voir la session : ${link}\n\n` : "") +
          `Si vous ne pouvez plus venir, désinscrivez-vous pour laisser la place au suivant.\n`,
      });
    }
  } catch (error) {
    console.error("[liste d'attente] notification impossible", error);
  }
}

// État d'une session pour les messages du groupe : terrains et places (invités compris).
export type SessionState = {
  id: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  courts: number[];
  // Horaires de chaque terrain, triés par terrain puis par heure.
  slots: { court: number; starts_at: string; ends_at: string }[];
  capacity: number;
  taken: number;
  waiting: number;
};

export async function sessionState(supabase: Client, sessionId: string): Promise<SessionState | null> {
  const [{ data: session }, { data: bookings }, { data: players }] = await Promise.all([
    supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle(),
    supabase
      .from("court_bookings")
      .select("court, starts_at, ends_at")
      .eq("session_id", sessionId)
      .order("court")
      .order("starts_at"),
    supabase.from("session_players").select("is_playing, spots").eq("session_id", sessionId),
  ]);
  if (!session) return null;
  const courts = [...new Set((bookings ?? []).map((b) => b.court))].sort((a, b) => a - b);
  const spots = (playing: boolean) =>
    (players ?? []).filter((p) => p.is_playing === playing).reduce((sum, p) => sum + p.spots, 0);
  return {
    id: session.id,
    venue: session.venue,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    courts,
    slots: bookings ?? [],
    capacity: sessionCapacity(bookings ?? []),
    taken: spots(true),
    waiting: spots(false),
  };
}

export type GroupEvent =
  // payers : celui qui a payé la réservation, et le second payeur s'il y en a un.
  | { kind: "added"; courts: number[]; startsAt: string; endsAt: string; payers: string[] }
  | { kind: "removed"; courts: number[]; startsAt: string; endsAt: string; before: SessionState }
  | { kind: "deleted"; before: SessionState }
  // Inscription d'un joueur, avec ses invités extérieurs ; playing = false s'il est en liste d'attente.
  | { kind: "joined"; guests: number; playing: boolean }
  // Un joueur déjà inscrit change son nombre d'invités.
  | { kind: "guests"; guests: number; playing: boolean }
  // Désinscription d'un joueur (et de ses invités) ; playing = false s'il était en liste d'attente.
  | { kind: "left"; guests: number; playing: boolean };

// « le terrain 7 », « les terrains 6 et 9 », « les terrains 6, 7 et 9 »
export function courtsLabel(courts: number[]) {
  const sorted = [...courts].sort((a, b) => a - b);
  if (sorted.length === 1) return `le terrain ${sorted[0]}`;
  return `les terrains ${sorted.slice(0, -1).join(", ")} et ${sorted.at(-1)}`;
}

// « Terrains : 6 · 9 » quand tous les terrains suivent les heures de la session, sinon une ligne
// par terrain avec ses horaires (deux créneaux qui se suivent sur un terrain n'en font qu'un).
export function courtLines(s: Pick<SessionState, "starts_at" | "ends_at" | "slots" | "courts">) {
  const same = (a: string, b: string) => Date.parse(a) === Date.parse(b);
  const byCourt = s.courts.map((court) => {
    const ranges: { starts_at: string; ends_at: string }[] = [];
    for (const b of s.slots.filter((b) => b.court === court)) {
      const last = ranges.at(-1);
      if (last && same(last.ends_at, b.starts_at)) last.ends_at = b.ends_at;
      else ranges.push({ starts_at: b.starts_at, ends_at: b.ends_at });
    }
    return { court, ranges };
  });
  const whole = byCourt.every(
    ({ ranges }) => ranges.length === 1 && same(ranges[0].starts_at, s.starts_at) && same(ranges[0].ends_at, s.ends_at),
  );
  if (whole) return [`Terrains : ${s.courts.join(" · ")}`];
  return [
    "Terrains :",
    ...byCourt.map(({ court, ranges }) => `• ${court} : ${ranges.map((r) => formatTimes(r.starts_at, r.ends_at)).join(", ")}`),
  ];
}

// Lignes communes : créneau, terrains (sauf pour une inscription), places restantes et lien.
function sessionLines(s: SessionState, link: string, { courts = true } = {}) {
  const free = Math.max(s.capacity - s.taken, 0);
  return [
    `${formatSlot(s.starts_at, s.ends_at)} · ${s.venue}`,
    ...(courts ? courtLines(s) : []),
    `Places restantes : ${free}` + (s.waiting ? ` (${s.waiting} en liste d'attente)` : ""),
    ...(link ? [link] : []),
  ];
}

// Barre verticale devant chaque ligne du détail d'une réservation ou annulation.
const BAR = "▎ ";

// Texte du message envoyé au groupe ; null pour une session déjà passée. Les messages de terrains
// commencent par un titre en gras (*…* dans WhatsApp) suivi d'un bloc marqué d'une barre, pour se distinguer
// des inscriptions.
// names : le ou les payeurs pour une réservation, sinon la personne qui annule ou supprime.
export function groupMessage(names: string[], event: GroupEvent, current: SessionState | null, link: string, now = Date.now()) {
  const actor = names.join(" et ");
  const ref = current ?? (event.kind === "added" || event.kind === "joined" || event.kind === "guests" || event.kind === "left" ? null : event.before);
  if (!ref || Date.parse(ref.ends_at) < now) return null;
  if (event.kind === "deleted") {
    const s = event.before;
    return [
      "❌ *SESSION SUPPRIMÉE*",
      `${actor} a supprimé la session`,
      `${formatSlot(s.starts_at, s.ends_at)} · ${s.venue}`,
      ...courtLines(s),
    ].join("\n");
  }
  if (event.kind === "joined") {
    const guests = event.guests ? ` avec ${event.guests} invité${event.guests > 1 ? "s" : ""}` : "";
    const waiting = event.playing ? "" : " (en liste d'attente)";
    return [`🙋 ${actor} s'inscrit${guests}${waiting}`, ...sessionLines(ref, link, { courts: false })].join("\n");
  }
  if (event.kind === "left") {
    const guests = event.guests ? ` avec ${event.guests} invité${event.guests > 1 ? "s" : ""}` : "";
    const waiting = event.playing ? "" : " (était en liste d'attente)";
    return [`👋 ${actor} se désinscrit${guests}${waiting}`, ...sessionLines(ref, link, { courts: false })].join("\n");
  }
  if (event.kind === "guests") {
    const guests = event.guests ? `avec ${event.guests} invité${event.guests > 1 ? "s" : ""}` : "sans invité";
    const waiting = event.playing ? "" : " (en liste d'attente)";
    return [`🙋 ${actor} vient ${guests}${waiting}`, ...sessionLines(ref, link, { courts: false })].join("\n");
  }
  // Heures du terrain, seulement si elles diffèrent de celles de la session.
  const times =
    Date.parse(event.startsAt) !== Date.parse(ref.starts_at) || Date.parse(event.endsAt) !== Date.parse(ref.ends_at) ? ` (${formatTimes(event.startsAt, event.endsAt)})` : "";
  // Un titre avec une pastille de couleur, puis le détail derrière une barre verticale pour que
  // les réservations et annulations ressortent dans le fil. Pas de citation « > » : WhatsApp en
  // fait un bloc séparé par ligne.
  const several = event.courts.length > 1;
  const title = event.kind === "added" ? `🟢 *TERRAIN${several ? "S" : ""} RÉSERVÉ${several ? "S" : ""}*` : `🔴 *TERRAIN${several ? "S" : ""} ANNULÉ${several ? "S" : ""}*`;
  const who = `${BAR}${actor} · ${courtsLabel(event.courts).replace(/^les? /, "")}${times}`;
  const s = current ?? ref;
  const free = Math.max(s.capacity - s.taken, 0);
  const places = current
    ? `${free} place${free > 1 ? "s" : ""} restante${free > 1 ? "s" : ""}` + (s.waiting ? ` (${s.waiting} en liste d'attente)` : "")
    : "session supprimée";
  return [
    title,
    who,
    `${BAR}*${formatSlot(s.starts_at, s.ends_at)}*`,
    ...(current ? courtLines(s).map((l) => `${BAR}${l}`) : []),
    `${BAR}${s.venue} · ${places}`,
    ...(current && link ? [link] : []),
  ].join("\n");
}

// Prévient le groupe WhatsApp d'une réservation ajoutée ou annulée, ou d'une session supprimée.
// Le message est préparé tout de suite (état de la session à cet instant) et envoyé après la
// réponse, pour ne pas ralentir l'action. Une erreur d'envoi est seulement journalisée.
export async function notifyGroup(supabase: Client, actorId: string, sessionId: string, event: GroupEvent) {
  try {
    // Une réservation est annoncée au nom de ses payeurs, pas de la personne qui l'a saisie ;
    // une inscription au nom du joueur inscrit (actorId).
    const ids = event.kind === "added" ? event.payers : [actorId];
    const [state, { data: profiles }] = await Promise.all([
      event.kind === "deleted" ? Promise.resolve(null) : sessionState(supabase, sessionId),
      supabase.from("profiles").select("id, display_name").in("id", ids),
    ]);
    const names = ids.map((id) => profiles?.find((p) => p.id === id)?.display_name ?? "Quelqu'un");
    const link = state ? await sessionLink(sessionId) : "";
    const message = groupMessage(names, event, state, link);
    if (!message) return;
    after(async () => {
      try {
        await sendToGroup(message);
      } catch (error) {
        console.error("[WhatsApp] message au groupe impossible", error);
      }
    });
  } catch (error) {
    console.error("[WhatsApp] message au groupe impossible", error);
  }
}

// Délai de prévenance : le rappel part 72h avant la session, l'annulation d'un terrain au Prisme
// doit se faire au plus tard 48h avant.
export const REMINDER_HOURS = 72;
export const CANCEL_HOURS = 48;

// Joueurs manquants pour remplir tous les terrains (invités compris).
export function missingPlayers(s: Pick<SessionState, "capacity" | "taken">) {
  return Math.max(s.capacity - s.taken, 0);
}

// Rappel au groupe quand il manque au moins un terrain entier de joueurs ; null sinon.
// On ne tranche rien : les inscrits peuvent jouer en simple, les oubliés s'inscrire, ou un
// capitaine annuler son terrain avant la limite des 48h.
export function emptyCourtReminder(s: SessionState, link: string) {
  const missing = missingPlayers(s);
  if (missing < PLAYERS_PER_COURT) return null;
  const deadline = new Date(Date.parse(s.starts_at) - CANCEL_HOURS * 3600e3).toISOString();
  const players = `${s.taken} inscrit${s.taken > 1 ? "s" : ""} pour ${s.capacity} places`;
  return [
    `⏰ *IL MANQUE ${missing} JOUEUR${missing > 1 ? "S" : ""}*`,
    `${BAR}${formatSlot(s.starts_at, s.ends_at)}`,
    ...courtLines(s).map((l) => `${BAR}${l}`),
    `${BAR}${s.venue} · ${players}`,
    "Vous venez ? Inscrivez-vous. Sinon, on en parle ici : on joue en simple, ou un capitaine annule son terrain " +
      `avant ${formatDay(deadline).toLowerCase()} à ${formatTime(deadline)} (48h avant).`,
    ...(link ? [link] : []),
  ].join("\n");
}
