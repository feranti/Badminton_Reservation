"use server";

import { refresh } from "next/cache";
import { requirePlayer } from "@/lib/session";

export type ProfileState = { error?: string; done?: boolean };

export async function updateDisplayName(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const { supabase, userId } = await requirePlayer();
  const name = String(formData.get("display_name") ?? "").trim();
  if (!name) return { error: "Le nom ne peut pas être vide." };
  if (name.length > 40) return { error: "40 caractères maximum." };
  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", userId);
  if (error) return { error: "Le nom n'a pas pu être enregistré." };
  refresh();
  return { done: true };
}
