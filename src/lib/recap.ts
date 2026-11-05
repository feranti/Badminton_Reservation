import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { APP_TIMEZONE, formatEuros } from "@/lib/format";
import { simplifyDebts } from "@/lib/settle";

type Balance = { player_id: string; display_name: string; balance_cents: number };
type PendingPayment = { from_player: string; to_player: string };

// Le récap part le lundi à 23 h, heure de Paris. Vercel planifie en heure UTC : la tâche est
// lancée à 21 h et à 22 h UTC, et seul l'appel qui tombe à 23 h à Paris envoie le message
// (21 h UTC en été, 22 h UTC en hiver).
export function isRecapTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return get("weekday") === "Mon" && get("hour") === "23";
}

// Texte du récap hebdomadaire : les virements à faire pour remettre tout le monde à zéro
// (la même liste que la page Comptes), puis le lien vers la page.
export function recapMessage(balances: Balance[], pending: PendingPayment[], link: string) {
  const name = (id: string) => balances.find((b) => b.player_id === id)?.display_name ?? "?";
  const transfers = simplifyDebts(balances);
  const lines = ["💰 *RÉCAP DES COMPTES*"];
  if (transfers.length === 0) lines.push("Tout le monde est à jour 👍");
  else {
    lines.push("Pour remettre les compteurs à zéro :");
    for (const t of transfers) {
      const signalled = pending.some((p) => p.from_player === t.from && p.to_player === t.to);
      lines.push(`• ${name(t.from)} → ${name(t.to)} : *${formatEuros(t.cents)}*` + (signalled ? " (signalé, à confirmer)" : ""));
    }
  }
  if (link) lines.push(link);
  return lines.join("\n");
}

// Lit les soldes et les remboursements en attente avec le client à clé secrète (pas de joueur
// connecté pour une tâche planifiée).
export async function buildRecap(admin: SupabaseClient<Database>, link: string) {
  const [balances, pending] = await Promise.all([
    admin.from("balances").select("player_id, display_name, balance_cents").order("balance_cents", { ascending: false }),
    admin.from("payments").select("from_player, to_player").is("confirmed_at", null),
  ]);
  if (balances.error) throw balances.error;
  if (pending.error) throw pending.error;
  return recapMessage(balances.data, pending.data, link);
}
