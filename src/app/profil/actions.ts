"use server";

import { refresh } from "next/cache";
import { attempt } from "@/lib/db";
import { requirePlayer } from "@/lib/session";

export type ProfileState = { error?: string; done?: boolean };

export async function updateDisplayName(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const { db, userId } = await requirePlayer();
  const name = String(formData.get("display_name") ?? "").trim();
  if (!name) return { error: "Le nom ne peut pas être vide." };
  if (name.length > 40) return { error: "40 caractères maximum." };
  const { error } = await attempt(db`update public.profiles set display_name = ${name} where id = ${userId}`);
  if (error) return { error: "Le nom n'a pas pu être enregistré." };
  refresh();
  return { done: true };
}
