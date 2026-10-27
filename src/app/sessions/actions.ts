"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { COURTS, MAX_GUESTS } from "@/lib/courts";
import { parisToIso, parseEurosToCents } from "@/lib/format";
import { notifyGroup, notifyPromotions, sessionState, snapshot } from "@/lib/notify";
import { requirePlayer } from "@/lib/session";

export type FormState = { error?: string; added?: boolean };

function readCourt(value: FormDataEntryValue | null) {
  const court = Number(value);
  return (COURTS as readonly number[]).includes(court) ? court : null;
}

// Créneau, prix et payeurs d'une réservation. Les heures saisies sont celles de Paris.
function readBooking(formData: FormData, userId: string) {
  const date = String(formData.get("date") ?? "");
  const startsAt = parisToIso(date, String(formData.get("start") ?? ""));
  const endsAt = parisToIso(date, String(formData.get("end") ?? ""));
  if (!startsAt || !endsAt) return { error: "Indiquez la date et les heures de début et de fin." } as const;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return { error: "L'heure de fin doit être après l'heure de début." } as const;

  const priceCents = parseEurosToCents(String(formData.get("price") ?? ""));
  if (priceCents === null) return { error: "Le prix doit être un montant en euros, par exemple 12,50." } as const;

  const bookedBy = String(formData.get("booked_by") ?? "") || userId;
  const coPayer = String(formData.get("co_payer") ?? "") || null;
  if (coPayer === bookedBy) return { error: "Choisissez deux payeurs différents." } as const;

  return {
    booking: {
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_price_cents: priceCents,
      p_booked_by: bookedBy,
      p_co_payer: coPayer,
    },
  } as const;
}

// Ajoute une ou plusieurs réservations (un terrain chacune). L'appli les range dans la bonne session.
export async function createBookings(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requirePlayer();
  const venue = String(formData.get("venue") ?? "").trim();
  if (!venue) return { error: "Indiquez le gymnase." };
  const courts = formData.getAll("courts").map(readCourt);
  if (courts.length === 0 || courts.some((c) => c === null)) return { error: "Cochez au moins un terrain." };
  const fields = readBooking(formData, userId);
  if ("error" in fields) return { error: fields.error };

  let sessionId = "";
  const booked: number[] = [];
  // Un seul message au groupe pour tous les terrains réservés, même si l'un d'eux échoue.
  const notify = () =>
    booked.length > 0 &&
    notifyGroup(supabase, userId, sessionId, {
      kind: "added",
      courts: booked,
      startsAt: fields.booking.p_starts_at,
      endsAt: fields.booking.p_ends_at,
    });
  for (const court of courts) {
    const { data, error } = await supabase.rpc("add_court_booking", { ...fields.booking, p_venue: venue, p_court: court! });
    if (error) {
      await notify();
      return {
        error: error.code === "23505" ? `Le terrain ${court} est déjà réservé sur ce créneau.` : "La réservation n'a pas pu être enregistrée.",
      };
    }
    sessionId = data;
    booked.push(court!);
  }

  if (formData.get("i_play") === "on") {
    await supabase
      .from("session_participants")
      .upsert({ session_id: sessionId, player_id: userId }, { onConflict: "session_id,player_id", ignoreDuplicates: true });
  }
  await notify();
  redirect(`/sessions/${sessionId}`);
}

// Ajoute une réservation depuis la page d'une session (même lieu, même jour).
export async function addBooking(sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requirePlayer();
  const court = readCourt(formData.get("court"));
  if (court === null) return { error: "Choisissez un terrain." };
  const fields = readBooking(formData, userId);
  if ("error" in fields) return { error: fields.error };
  const { data: session } = await supabase.from("sessions").select("venue").eq("id", sessionId).single();
  if (!session) return { error: "Cette session n'existe plus." };

  const before = await snapshot(supabase, sessionId);
  const { data: newSessionId, error } = await supabase.rpc("add_court_booking", {
    ...fields.booking,
    p_venue: session.venue,
    p_court: court,
  });
  if (error) {
    return { error: error.code === "23505" ? `Le terrain ${court} est déjà réservé sur ce créneau.` : "La réservation n'a pas pu être ajoutée." };
  }
  // Plus de terrains = plus de places : des joueurs en attente peuvent passer joueurs.
  await notifyPromotions(supabase, newSessionId, before, userId);
  await notifyGroup(supabase, userId, newSessionId, {
    kind: "added",
    courts: [court],
    startsAt: fields.booking.p_starts_at,
    endsAt: fields.booking.p_ends_at,
  });
  if (newSessionId !== sessionId) redirect(`/sessions/${newSessionId}`);
  refresh();
  return { added: true };
}

export async function removeBooking(bookingId: string) {
  const { supabase, userId } = await requirePlayer();
  const { data: booking } = await supabase
    .from("court_bookings")
    .select("session_id, qr_path, court, starts_at, ends_at")
    .eq("id", bookingId)
    .single();
  const before = booking ? await sessionState(supabase, booking.session_id) : null;
  const { error } = await supabase.rpc("remove_court_booking", { p_booking: bookingId });
  if (booking && before && !error) {
    await notifyGroup(supabase, userId, booking.session_id, {
      kind: "removed",
      courts: [booking.court],
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      before,
    });
  }
  if (booking?.qr_path) await supabase.storage.from("qr-codes").remove([booking.qr_path]);
  const { data: still } = booking
    ? await supabase.from("sessions").select("id").eq("id", booking.session_id).maybeSingle()
    : { data: null };
  if (!still) redirect("/");
  refresh();
}

export async function updateSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requirePlayer();
  const id = String(formData.get("id") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!venue) return { error: "Indiquez le gymnase." };
  const { error } = await supabase.from("sessions").update({ venue, notes }).eq("id", id);
  if (error) return { error: "La modification n'a pas pu être enregistrée." };
  // Le bouton OK de l'écran Gérer enregistre puis revient à la session.
  if (formData.get("done")) redirect(`/sessions/${id}`);
  refresh();
  return { added: true };
}

export async function deleteSession(id: string) {
  const { supabase, userId } = await requirePlayer();
  const { data: bookings } = await supabase.from("court_bookings").select("qr_path").eq("session_id", id);
  const paths = (bookings ?? []).map((b) => b.qr_path).filter((p): p is string => Boolean(p));
  const before = await sessionState(supabase, id);
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (before && !error) await notifyGroup(supabase, userId, id, { kind: "deleted", before });
  if (paths.length) await supabase.storage.from("qr-codes").remove(paths);
  redirect("/");
}

export async function addParticipant(sessionId: string, playerId: string, guests = 0) {
  const { supabase } = await requirePlayer();
  await supabase
    .from("session_participants")
    .upsert({ session_id: sessionId, player_id: playerId, guests }, { onConflict: "session_id,player_id", ignoreDuplicates: true });
  refresh();
}

function readGuests(formData: FormData) {
  const guests = Number(formData.get("guests") ?? 0);
  return Number.isInteger(guests) && guests >= 0 && guests <= MAX_GUESTS ? guests : null;
}

// Inscription du joueur connecté, seul ou avec des invités extérieurs (+1, +2…).
// Si toutes les places du groupe ne tiennent pas, le groupe entier passe en liste d'attente.
export async function joinSession(sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { userId } = await requirePlayer();
  const guests = readGuests(formData);
  if (guests === null) return { error: "Nombre d'invités incorrect." };
  await addParticipant(sessionId, userId, guests);
  return {};
}

// Change le nombre d'invités du joueur connecté. Un joueur qui a déjà sa place ne peut ajouter
// des invités que dans les places libres : il ne fait pas passer les autres en liste d'attente.
export async function setGuests(sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requirePlayer();
  const guests = readGuests(formData);
  if (guests === null) return { error: "Nombre d'invités incorrect." };
  const { data: players } = await supabase
    .from("session_players")
    .select("player_id, is_playing, guests, spots, capacity")
    .eq("session_id", sessionId);
  const me = players?.find((p) => p.player_id === userId);
  if (!players || !me) return { error: "Vous n'êtes plus inscrit à cette session." };
  if (me.is_playing && guests > me.guests) {
    const used = players.filter((p) => p.is_playing).reduce((sum, p) => sum + p.spots, 0);
    const free = Math.max(me.capacity - used, 0);
    if (guests - me.guests > free) {
      return {
        error:
          free === 0
            ? "La session est complète : impossible d'ajouter un invité."
            : `Il ne reste que ${free} place${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}.`,
      };
    }
  }

  const before = await snapshot(supabase, sessionId);
  const { error } = await supabase
    .from("session_participants")
    .update({ guests })
    .eq("session_id", sessionId)
    .eq("player_id", userId);
  if (error) return { error: "Le nombre d'invités n'a pas pu être modifié." };
  // Moins d'invités = des places libérées pour la liste d'attente.
  await notifyPromotions(supabase, sessionId, before, userId);
  refresh();
  return {};
}

// Désinscription : le premier de la liste d'attente prend la place et reçoit un e-mail.
export async function removeParticipant(sessionId: string, playerId: string) {
  const { supabase, userId } = await requirePlayer();
  const before = await snapshot(supabase, sessionId);
  await supabase.from("session_participants").delete().eq("session_id", sessionId).eq("player_id", playerId);
  await notifyPromotions(supabase, sessionId, before, userId);
  refresh();
}

// Depuis la liste déroulante « Inscrire un joueur » de la page d'une session.
export async function addParticipantFromForm(sessionId: string, formData: FormData) {
  const playerId = String(formData.get("player_id") ?? "");
  if (playerId) await addParticipant(sessionId, playerId);
}

export async function setQrPath(bookingId: string, path: string | null) {
  const { supabase } = await requirePlayer();
  const { data: old } = await supabase.from("court_bookings").select("qr_path").eq("id", bookingId).single();
  await supabase.from("court_bookings").update({ qr_path: path }).eq("id", bookingId);
  if (old?.qr_path && old.qr_path !== path) await supabase.storage.from("qr-codes").remove([old.qr_path]);
  refresh();
}
