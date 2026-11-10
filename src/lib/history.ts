// Texte de l'historique d'une session (supabase/migrations/0007_historique_sessions.sql).
import type { Json } from "@/lib/database.types";
import { formatDay, formatEuros, formatTime, formatTimes, toDateAndTime } from "@/lib/format";

export type HistoryEvent = {
  id: number;
  kind: string;
  actor_id: string | null;
  player_id: string | null;
  details: Json;
  created_at: string;
};

// Morceaux de la phrase : les noms sont en gras.
export type Part = string | { name: string };
export type Tone = "green" | "red" | "yellow" | "neutral";
export type EventLine = { icon: string; tone: Tone; parts: Part[]; detail: string[]; changes: string[] };

// Filtres de la page Historique.
export const FILTERS = {
  inscriptions: { label: "Inscriptions", kinds: ["joined", "left", "guests", "promoted", "demoted"] },
  terrains: { label: "Terrains", kinds: ["booking_added", "booking_removed"] },
  modifs: { label: "Modifs", kinds: ["created", "updated", "booking_updated", "merged", "deleted"] },
} as const;
export type Filter = keyof typeof FILTERS;

type Details = Record<string, Json | undefined>;
const obj = (v: Json | undefined): Details => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v: Json | undefined) => (typeof v === "string" ? v : null);
const num = (v: Json | undefined) => (typeof v === "number" ? v : 0);

const guestsText = (n: number) => `${n} invité${n > 1 ? "s" : ""}`;
const and = (names: string[]) => names.join(", ").replace(/, ([^,]*)$/, " et $1");

export function describeEvent(e: HistoryEvent, nameOf: (id: string | null) => string): EventLine {
  const d = obj(e.details);
  const actor = { name: nameOf(e.actor_id) };
  const player = { name: nameOf(e.player_id) };
  // Action faite par le joueur lui-même (ou reprise de l'existant, sans auteur connu).
  const self = !e.actor_id || e.actor_id === e.player_id;
  const court = `le terrain ${num(d.court)}`;
  const times = str(d.starts_at) && str(d.ends_at) ? formatTimes(str(d.starts_at)!, str(d.ends_at)!) : null;
  const line = (icon: string, tone: Tone, parts: Part[], detail: (string | null | false)[] = [], changes: string[] = []): EventLine => ({
    icon,
    tone,
    parts,
    detail: detail.filter((x): x is string => Boolean(x)),
    changes,
  });

  switch (e.kind) {
    case "created":
      return line("✨", "green", [actor, " a créé la session"], [str(d.venue)]);
    case "updated": {
      const venue = obj(d.venue);
      const notes = obj(d.notes);
      const changes = [
        ...(d.venue ? [`Lieu : ${str(venue.from)} → ${str(venue.to)}`] : []),
        ...(d.notes ? [str(notes.to) ? `Note : « ${str(notes.to)} »` : "Note supprimée"] : []),
      ];
      return line("✏️", "yellow", [actor, " a modifié la session"], [], changes);
    }
    case "deleted":
      return line("❌", "red", [actor, " a supprimé la session"]);
    case "merged":
      return line("🔗", "neutral", ["La session voisine a été rattachée"], [times && `créneau ${times}`, e.actor_id && `par ${actor.name}`]);
    case "booking_added": {
      const payers = [player.name, ...(str(d.co_payer) ? [nameOf(str(d.co_payer))] : [])];
      const saisi = e.actor_id && !payers.includes(actor.name) ? `saisi par ${actor.name}` : null;
      return line("🟢", "green", [...payers.flatMap((n, i) => (i ? [" et ", { name: n }] : [{ name: n }])), ` ${payers.length > 1 ? "ont" : "a"} réservé ${court}`], [
        times,
        formatEuros(num(d.price_cents)),
        saisi,
      ]);
    }
    case "booking_removed":
      return line("🔴", "red", [actor, ` a annulé ${court}`], [times]);
    case "booking_updated": {
      const price = obj(d.price);
      const payers = obj(d.payers);
      const names = (v: Json | undefined) => and((Array.isArray(v) ? v : []).map(str).filter((x): x is string => Boolean(x)).map(nameOf));
      const changes = [
        ...(d.price ? [`Prix : ${formatEuros(num(price.from))} → ${formatEuros(num(price.to))}`] : []),
        ...(d.payers ? [`Payeurs : ${names(payers.from)} → ${names(payers.to)}`] : []),
      ];
      return line("✏️", "yellow", [actor, ` a modifié ${court}`], [times], changes);
    }
    case "joined":
      return line("🙋", "neutral", self ? [player, " s'est inscrit"] : [actor, " a inscrit ", player], [
        num(d.guests) > 0 && `avec ${guestsText(num(d.guests))}`,
        d.waiting === true && "en liste d'attente",
      ]);
    case "guests": {
      const to = num(d.to);
      const from = num(d.from);
      return line("🙋", "neutral", [player, to ? ` vient avec ${guestsText(to)}` : " vient sans invité"], [
        `avant : ${from ? guestsText(from) : "sans invité"}`,
        d.waiting === true && "en liste d'attente",
      ]);
    }
    case "left":
      return line("👋", "red", self ? [player, " s'est désinscrit"] : [actor, " a retiré ", player], [
        num(d.guests) > 0 && `avec ${guestsText(num(d.guests))}`,
        d.waiting === true && "était en liste d'attente",
      ]);
    case "promoted":
      return line("⏫", "green", [player, " passe de la liste d'attente aux joueurs"], ["automatique"]);
    case "demoted":
      return line("⏬", "yellow", [player, " passe en liste d'attente"], ["automatique, une place en moins"]);
    default:
      return line("•", "neutral", ["Changement"]);
  }
}

// Jour (à Paris) d'un événement, pour regrouper la page Historique : « Aujourd'hui », « Hier »,
// sinon « Samedi 14 novembre ».
export function dayLabel(iso: string, now = new Date()) {
  const day = toDateAndTime(iso).date;
  const today = toDateAndTime(now.toISOString()).date;
  const yesterday = toDateAndTime(new Date(now.getTime() - 864e5).toISOString()).date;
  if (day === today) return "Aujourd'hui";
  if (day === yesterday) return "Hier";
  return formatDay(iso);
}

// « Aujourd'hui à 09:12 », « Hier à 22:40 », « Samedi 14 nov. à 11:30 »
export function whenLabel(iso: string, now = new Date()) {
  const day = dayLabel(iso, now);
  return `${day === "Aujourd'hui" || day === "Hier" ? day : formatDay(iso, true)} à ${formatTime(iso)}`;
}
