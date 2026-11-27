import { after } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { PLAYERS_PER_COURT, sessionCapacity } from "@/lib/courts";
import type { Tables } from "@/lib/database.types";
import { adminDb, type Db } from "@/lib/db";
import { formatDay, formatSlot, formatTime, formatTimes } from "@/lib/format";
import { sendMail } from "@/lib/mail";
import { sendToGroup } from "@/lib/whatsapp";

// guests : invités de chaque joueur inscrit ; guestsPlaying : ceux d'entre eux qui ont une place.
export type Snapshot = {
  registered: Set<string>;
  playing: Set<string>;
  guests: Map<string, number>;
  guestsPlaying: Map<string, number>;
};

// Inscrits et joueurs effectifs (hors liste d'attente) d'une session, à un instant donné.
export async function snapshot(db: Db, sessionId: string): Promise<Snapshot> {
  const data = await db<{ player_id: string; is_playing: boolean; guests: number; guests_waiting: number }>`
    select player_id, is_playing, guests, guests_waiting from public.session_players where session_id = ${sessionId}`;
  return {
    registered: new Set(data.map((p) => p.player_id)),
    playing: new Set(data.filter((p) => p.is_playing).map((p) => p.player_id)),
    guests: new Map(data.map((p) => [p.player_id, p.guests])),
    guestsPlaying: new Map(data.map((p) => [p.player_id, p.guests - p.guests_waiting])),
  };
}

type WaitingChange = { player_id: string; kind: "promoted" | "demoted"; guests: number; guestsOnly: boolean };

// Passages liste d'attente ↔ joueurs entre deux instants. Un joueur qui passe emmène ses invités
// qui passent avec lui (guests) ; guestsOnly : le joueur garde sa place, seuls ses invités passent.
// Les invités d'un joueur dont le nombre d'invités a changé entre-temps (le joueur qui agit) ne
// comptent pas : ce sont les siens qu'il ajoute ou retire.
function waitingChanges(before: Snapshot, after: Snapshot): WaitingChange[] {
  const changes: WaitingChange[] = [];
  for (const id of after.registered) {
    if (!before.registered.has(id)) continue;
    const was = before.playing.has(id);
    const is = after.playing.has(id);
    const guestsBefore = before.guestsPlaying.get(id) ?? 0;
    const guestsAfter = after.guestsPlaying.get(id) ?? 0;
    if (!was && is) changes.push({ player_id: id, kind: "promoted", guests: guestsAfter, guestsOnly: false });
    else if (was && !is) changes.push({ player_id: id, kind: "demoted", guests: guestsBefore, guestsOnly: false });
    else if (was && is && before.guests.get(id) === after.guests.get(id) && guestsAfter !== guestsBefore) {
      changes.push({
        player_id: id,
        kind: guestsAfter > guestsBefore ? "promoted" : "demoted",
        guests: Math.abs(guestsAfter - guestsBefore),
        guestsOnly: true,
      });
    }
  }
  return changes;
}

// Adresse complète de la page d'une session, sur l'adresse publique du site (src/lib/app-url.ts).
async function sessionLink(sessionId: string) {
  const origin = await appOrigin();
  return origin ? `${origin}/sessions/${sessionId}` : "";
}

// Note dans l'historique de la session les joueurs (ou leurs invités) passés de la liste d'attente
// aux joueurs effectifs, ou l'inverse (terrain retiré). Renvoie les changements.
async function logWaitingChanges(db: Db, sessionId: string, before: Snapshot) {
  const events = waitingChanges(before, await snapshot(db, sessionId));
  if (events.length) {
    try {
      await db.tx(async (tx) => {
        for (const e of events) {
          await tx`
            select public.log_waiting_change(${sessionId}::uuid, ${e.player_id}::uuid, ${e.kind}, ${e.guests}::integer, ${e.guestsOnly})`;
        }
      });
    } catch (error) {
      console.error("[historique] liste d'attente non notée", error);
    }
  }
  return events;
}

// Note dans l'historique les passages liste d'attente ↔ joueurs, et prévient par e-mail les joueurs
// qui viennent de passer de la liste d'attente aux joueurs effectifs, ou dont un invité vient d'y passer.
// N'interrompt jamais l'action en cours : une erreur d'envoi est seulement journalisée.
export async function notifyPromotions(db: Db, sessionId: string, before: Snapshot, actorId: string) {
  try {
    const changes = await logWaitingChanges(db, sessionId, before);
    const promoted = changes.filter((c) => c.kind === "promoted" && c.player_id !== actorId);
    if (promoted.length === 0) return;
    const [session] = await db<Tables<"sessions">>`select * from public.sessions where id = ${sessionId}`;
    if (!session) return;

    const link = await sessionLink(sessionId);
    const slot = formatSlot(session.starts_at, session.ends_at);

    for (const { player_id, guests, guestsOnly } of promoted) {
      // Les adresses e-mail sont dans auth.users, lisible seulement par le propriétaire de la base.
      const [user] = await adminDb<{ email: string | null }>`select email from auth.users where id = ${player_id}`;
      const email = user?.email;
      if (!email) continue;
      const them = guests > 1 ? `${guests} de vos invités` : "votre invité";
      await sendMail({
        to: email,
        subject: guestsOnly
          ? `Une place s'est libérée : ${them} joue ${slot.toLowerCase()}`
          : `Une place s'est libérée : vous jouez ${slot.toLowerCase()}`,
        text:
          (guestsOnly
            ? `Bonne nouvelle ! Une place s'est libérée et ${them} ${guests > 1 ? "passent" : "passe"} de la liste d'attente aux joueurs de la session :\n\n`
            : `Bonne nouvelle ! Une place s'est libérée et vous passez de la liste d'attente aux joueurs de la session :\n\n`) +
          `${slot}\n${session.venue}\n\n` +
          (link ? `Voir la session : ${link}\n\n` : "") +
          (guestsOnly
            ? `Si ${guests > 1 ? "ils ne peuvent" : "il ne peut"} plus venir, retirez-${guests > 1 ? "les" : "le"} pour laisser la place au suivant.\n`
            : `Si vous ne pouvez plus venir, désinscrivez-vous pour laisser la place au suivant.\n`),
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

export async function sessionState(db: Db, sessionId: string): Promise<SessionState | null> {
  const [[session], bookings, players] = await db.tx((tx) =>
    Promise.all([
      tx<Tables<"sessions">[]>`select * from public.sessions where id = ${sessionId} and cancelled_at is null`,
      tx<{ court: number; starts_at: string; ends_at: string }[]>`
        select court, starts_at, ends_at from public.court_bookings
        where session_id = ${sessionId} and cancelled_at is null
        order by court, starts_at`,
      tx<{ is_playing: boolean; spots: number; guests_waiting: number }[]>`
        select is_playing, spots, guests_waiting from public.session_players where session_id = ${sessionId}`,
    ]),
  );
  if (!session) return null;
  const courts = [...new Set(bookings.map((b) => b.court))].sort((a, b) => a - b);
  // Places prises par ceux qui jouent ; en attente : les joueurs qui attendent et tous les invités
  // en attente (y compris ceux d'un joueur qui a sa place).
  const taken = players.reduce((sum, p) => sum + p.spots, 0);
  const waiting = players.reduce((sum, p) => sum + (p.is_playing ? 0 : 1) + p.guests_waiting, 0);
  return {
    id: session.id,
    venue: session.venue,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    courts,
    slots: [...bookings],
    capacity: sessionCapacity(bookings),
    taken,
    waiting,
  };
}

export type GroupEvent =
  // payers : celui qui a payé la réservation, et le second payeur s'il y en a un.
  | { kind: "added"; courts: number[]; startsAt: string; endsAt: string; payers: string[] }
  | { kind: "removed"; courts: number[]; startsAt: string; endsAt: string; before: SessionState }
  | { kind: "deleted"; before: SessionState }
  // Inscription d'un joueur, avec ses invités extérieurs ; playing = false s'il est en liste d'attente ;
  // guestsWaiting = ceux de ses invités qui sont en liste d'attente alors que lui joue.
  | { kind: "joined"; guests: number; playing: boolean; guestsWaiting?: number }
  // Un joueur déjà inscrit change son nombre d'invités.
  | { kind: "guests"; guests: number; playing: boolean; guestsWaiting?: number }
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

// « (en liste d'attente) » pour un joueur qui attend, « (son invité en liste d'attente) » quand
// il joue mais pas ses invités, « (1 en liste d'attente) » quand une partie d'entre eux attend.
function waitingText(event: { playing: boolean; guests: number; guestsWaiting?: number }) {
  if (!event.playing) return " (en liste d'attente)";
  const n = event.guestsWaiting ?? 0;
  if (n === 0) return "";
  return n === event.guests ? ` (${n > 1 ? "ses invités" : "son invité"} en liste d'attente)` : ` (${n} en liste d'attente)`;
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
      // La session annulée reste consultable dans l'appli.
      ...(link ? [link] : []),
    ].join("\n");
  }
  if (event.kind === "joined") {
    const guests = event.guests ? ` avec ${event.guests} invité${event.guests > 1 ? "s" : ""}` : "";
    const waiting = waitingText(event);
    return [`🙋 ${actor} s'inscrit${guests}${waiting}`, ...sessionLines(ref, link, { courts: false })].join("\n");
  }
  if (event.kind === "left") {
    const guests = event.guests ? ` avec ${event.guests} invité${event.guests > 1 ? "s" : ""}` : "";
    const waiting = event.playing ? "" : " (était en liste d'attente)";
    return [`👋 ${actor} se désinscrit${guests}${waiting}`, ...sessionLines(ref, link, { courts: false })].join("\n");
  }
  if (event.kind === "guests") {
    const guests = event.guests ? `avec ${event.guests} invité${event.guests > 1 ? "s" : ""}` : "sans invité";
    const waiting = waitingText(event);
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
    ...(link ? [link] : []),
  ].join("\n");
}

// Prévient le groupe WhatsApp d'une réservation ajoutée ou annulée, ou d'une session supprimée.
// Le message est préparé tout de suite (état de la session à cet instant) et envoyé après la
// réponse, pour ne pas ralentir l'action. Une erreur d'envoi est seulement journalisée.
export async function notifyGroup(db: Db, actorId: string, sessionId: string, event: GroupEvent) {
  try {
    // Une réservation est annoncée au nom de ses payeurs, pas de la personne qui l'a saisie ;
    // une inscription au nom du joueur inscrit (actorId).
    const ids = event.kind === "added" ? event.payers : [actorId];
    const [state, profiles] = await Promise.all([
      event.kind === "deleted" ? Promise.resolve(null) : sessionState(db, sessionId),
      db<{ id: string; display_name: string }>`select id, display_name from public.profiles where id = any(${ids}::uuid[])`,
    ]);
    const names = ids.map((id) => profiles.find((p) => p.id === id)?.display_name ?? "Quelqu'un");
    // Lien aussi pour une session annulée : elle reste consultable.
    const link = await sessionLink(sessionId);
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
