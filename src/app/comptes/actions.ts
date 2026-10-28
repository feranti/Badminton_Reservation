"use server";

import { refresh } from "next/cache";
import { parseEurosToCents } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export type PaymentState = { error?: string; done?: boolean };

// Signale un remboursement. Déclaré par celui qui reçoit l'argent, il est confirmé tout de suite ;
// déclaré par celui qui paie, il attend la confirmation du bénéficiaire.
export async function declarePayment(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const { supabase, userId } = await requirePlayer();
  const fromPlayer = String(formData.get("from_player") ?? "");
  const toPlayer = String(formData.get("to_player") ?? "");
  const amountCents = parseEurosToCents(String(formData.get("amount") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!fromPlayer || !toPlayer) return { error: "Choisissez qui a payé et qui a reçu." };
  if (fromPlayer === toPlayer) return { error: "Choisissez deux joueurs différents." };
  if (userId !== fromPlayer && userId !== toPlayer) {
    return { error: "Vous ne pouvez signaler qu'un remboursement que vous avez fait ou reçu." };
  }
  if (!amountCents) return { error: "Le montant doit être en euros, par exemple 12,50." };
  // Limites aussi vérifiées en base (supabase/migrations/0001_init.sql).
  if (amountCents > 1_000_000) return { error: "Le montant ne peut pas dépasser 10 000 €." };
  if (note && note.length > 200) return { error: "Note : 200 caractères maximum." };

  const { error } = await supabase.from("payments").insert({
    from_player: fromPlayer,
    to_player: toPlayer,
    amount_cents: amountCents,
    note,
    confirmed_at: userId === toPlayer ? new Date().toISOString() : null,
  });
  if (error) return { error: "Le remboursement n'a pas pu être enregistré." };
  refresh();
  return { done: true };
}

export async function confirmPayment(paymentId: string) {
  const { supabase, userId } = await requirePlayer();
  await supabase
    .from("payments")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", paymentId)
    .eq("to_player", userId);
  refresh();
}

// Annule (par celui qui l'a déclaré) ou refuse (par le bénéficiaire) un remboursement en attente.
export async function cancelPayment(paymentId: string) {
  const { supabase } = await requirePlayer();
  await supabase.from("payments").delete().eq("id", paymentId).is("confirmed_at", null);
  refresh();
}

// Bouton « J'ai payé » ou « J'ai reçu » d'une ligne de la liste « qui doit à qui ».
export async function declareTransfer(fromPlayer: string, toPlayer: string, amountCents: number) {
  const formData = new FormData();
  formData.set("from_player", fromPlayer);
  formData.set("to_player", toPlayer);
  formData.set("amount", (amountCents / 100).toFixed(2));
  await declarePayment({}, formData);
}
