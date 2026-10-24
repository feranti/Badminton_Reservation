"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { COURTS } from "@/lib/courts";
import { parisToIso, parseEurosToCents } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export type FormState = { error?: string };

// Lit et vérifie les champs communs d'une soirée. Les heures saisies sont celles de Paris.
function readSessionFields(formData: FormData) {
  const venue = String(formData.get("venue") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const date = String(formData.get("date") ?? "");
  const startsAt = parisToIso(date, String(formData.get("start") ?? ""));
  const endsAt = parisToIso(date, String(formData.get("end") ?? ""));

  if (!venue) return { error: "Indiquez le gymnase." } as const;
  if (!startsAt || !endsAt) {
    return { error: "Indiquez la date et les heures de début et de fin." } as const;
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    return { error: "L'heure de fin doit être après l'heure de début." } as const;
  }
  return { values: { venue, notes, starts_at: startsAt, ends_at: endsAt } } as const;
}

function readCourt(value: FormDataEntryValue | null) {
  const court = Number(value);
  return (COURTS as readonly number[]).includes(court) ? court : null;
}

export async function createSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requirePlayer();
  const fields = readSessionFields(formData);
  if ("error" in fields) return { error: fields.error };

  const courts = formData.getAll("courts").map(readCourt);
  if (courts.length === 0 || courts.some((c) => c === null)) {
    return { error: "Cochez au moins un terrain." };
  }
  const priceCents = parseEurosToCents(String(formData.get("price") ?? ""));
  if (priceCents === null) return { error: "Le prix doit être un montant en euros, par exemple 12,50." };
  const bookedBy = String(formData.get("booked_by") ?? "") || userId;

  const { data: session, error } = await supabase.from("sessions").insert(fields.values).select("id").single();
  if (error) return { error: "La soirée n'a pas pu être enregistrée." };

  const { error: courtsError } = await supabase.from("court_bookings").insert(
    courts.map((court) => ({ session_id: session.id, court: court!, price_cents: priceCents, booked_by: bookedBy })),
  );
  if (courtsError) {
    await supabase.from("sessions").delete().eq("id", session.id);
    return { error: "Les terrains n'ont pas pu être enregistrés." };
  }

  if (formData.get("i_play") === "on") {
    await supabase.from("session_participants").insert({ session_id: session.id, player_id: userId });
  }
  redirect("/");
}

export async function updateSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requirePlayer();
  const id = String(formData.get("id") ?? "");
  const fields = readSessionFields(formData);
  if ("error" in fields) return { error: fields.error };
  const { error } = await supabase.from("sessions").update(fields.values).eq("id", id);
  if (error) return { error: "La modification n'a pas pu être enregistrée." };
  redirect("/");
}

export async function deleteSession(id: string) {
  const { supabase } = await requirePlayer();
  await supabase.from("sessions").delete().eq("id", id);
  redirect("/");
}

export async function addCourt(sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requirePlayer();
  const court = readCourt(formData.get("court"));
  if (court === null) return { error: "Choisissez un terrain." };
  const priceCents = parseEurosToCents(String(formData.get("price") ?? ""));
  if (priceCents === null) return { error: "Le prix doit être un montant en euros, par exemple 12,50." };
  const bookedBy = String(formData.get("booked_by") ?? "") || userId;

  const { error } = await supabase
    .from("court_bookings")
    .insert({ session_id: sessionId, court, price_cents: priceCents, booked_by: bookedBy });
  if (error) {
    return { error: error.code === "23505" ? `Le terrain ${court} est déjà dans cette soirée.` : "Le terrain n'a pas pu être ajouté." };
  }
  refresh();
  return {};
}

export async function removeCourt(courtBookingId: string) {
  const { supabase } = await requirePlayer();
  await supabase.from("court_bookings").delete().eq("id", courtBookingId);
  refresh();
}

export async function addParticipant(sessionId: string, playerId: string) {
  const { supabase } = await requirePlayer();
  await supabase
    .from("session_participants")
    .upsert({ session_id: sessionId, player_id: playerId }, { onConflict: "session_id,player_id", ignoreDuplicates: true });
  refresh();
}

export async function removeParticipant(sessionId: string, playerId: string) {
  const { supabase } = await requirePlayer();
  await supabase.from("session_participants").delete().eq("session_id", sessionId).eq("player_id", playerId);
  refresh();
}

// Depuis la liste déroulante « Ajouter un joueur » de la page d'une soirée.
export async function addParticipantFromForm(sessionId: string, formData: FormData) {
  const playerId = String(formData.get("player_id") ?? "");
  if (playerId) await addParticipant(sessionId, playerId);
}
