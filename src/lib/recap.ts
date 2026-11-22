import type { Db } from "@/lib/db";
import { formatEuros } from "@/lib/format";
import { simplifyDebts } from "@/lib/settle";

type Balance = { player_id: string; display_name: string; balance_cents: number };
type PendingPayment = { from_player: string; to_player: string };

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

// Lit les soldes et les remboursements en attente sans joueur connecté (tâche planifiée).
export async function buildRecap(admin: Db, link: string) {
  const [balances, pending] = await Promise.all([
    admin<Balance>`select player_id, display_name, balance_cents from public.balances order by balance_cents desc`,
    admin<PendingPayment>`select from_player, to_player from public.payments where confirmed_at is null and cancelled_at is null`,
  ]);
  return recapMessage(balances, pending, link);
}
