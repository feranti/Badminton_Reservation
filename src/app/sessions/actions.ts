"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { cardPrice, COURTS, MAX_GUESTS } from "@/lib/courts";
import { parisToIso, parseEurosToCents } from "@/lib/format";
import { notifyGroup, notifyPromotions, sessionState, snapshot } from "@/lib/notify";
import { requirePlayer } from "@/lib/session";

export type FormState = { error?: string; added?: boolean };

// Limites aussi vérifiées en base (supabase/migrations/0001_init.sql).
const MAX_PRICE_CENTS = 100_000;
const MAX_VENUE = 100;
const MAX_NOTES = 500;

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

  const bookedBy = String(formData.get("booked_by") ?? "") || userId;
  const coPayer = String(formData.get("co_payer") ?? "") || null;
  if (coPayer === bookedBy) return { error: "Choisissez deux payeurs différents." } as const;

  // Tarif carte 10 sessions (Prisme) : le prix est calculé ici à partir des cartes cochées.
  const cardPricing = formData.get("card_pricing") === "on";
  const bookedByCard = cardPricing && formData.get("booked_by_card") === "on";
  const coPayerCard = cardPricing && coPayer !== null && formData.get("co_payer_card") === "on";
  const minutes = (Date.parse(endsAt) - Date.parse(startsAt)) / 60000;
  const priceCents = cardPricing
    ? cardPrice({ captainCard: bookedByCard, partner: coPayer !== null, partnerCard: coPayerCard }, minutes).total
    : parseEurosToCents(String(formData.get("price") ?? ""));
  if (priceCents === null) return { error: "Le prix doit être un montant en euros, par exemple 12,50." } as const;
  if (priceCents > MAX_PRICE_CENTS) return { error: "Le prix d'un terrain ne peut pas dépasser 1 000 €." } as const;

  return {
    booking: {
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_price_cents: priceCents,
      p_booked_by: bookedBy,
      p_co_payer: coPayer,
      p_card_pricing: cardPricing,
      p_booked_by_card: bookedByCard,
      p_co_payer_card: coPayerCard,
    },
  } as const;
}

// Payeur de la réservation, puis le second payeur s'il y en a un.
function payers(booking: { p_booked_by: string; p_co_payer: string | null }) {
  return booking.p_co_payer ? [booking.p_booked_by, booking.p_co_payer] : [booking.p_booked_by];
}

// Inscrit les payeurs de la réservation (sauf la personne qui la saisit, qui choisit avec « Je joue »)
// et, s'il joue, le joueur connecté. Un joueur déjà inscrit garde sa place et ses invités.
async function joinPayers(
  supabase: Awaited<ReturnType<typeof requirePlayer>>["supabase"],
  sessionId: string,
  booking: { p_booked_by: string; p_co_payer: string | null },
  userId: string,
  iPlay: boolean,
) {
  const ids = [...new Set([...(iPlay ? [userId] : []), ...payers(booking).filter((id) => id !== userId)])];
  if (ids.length === 0) return;
  await supabase.rpc("add_participants", { p_session: sessionId, p_players: ids });
}

// Ajoute une ou plusieurs réservations (un terrain chacune). L'appli les range dans la bonne session.
export async function createBookings(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, userId } = await requirePlayer();
  const venue = String(formData.get("venue") ?? "").trim();
  if (!venue) return { error: "Indiquez le gymnase." };
  if (venue.length > MAX_VENUE) return { error: `Nom du gymnase : ${MAX_VENUE} caractères maximum.` };
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
      payers: payers(fields.booking),
    });
  for (const court of courts) {
    const { data, error } = await supabase.rpc("add_court_booking", { ...fields.booking, p_venue: venue, p_court: court! });
    if (error) {
      if (sessionId) await joinPayers(supabase, sessionId, fields.booking, userId, formData.get("i_play") === "on");
      await notify();
      return {
        error: error.code === "23505" ? `Le terrain ${court} est déjà réservé sur ce créneau.` : "La réservation n'a pas pu être enregistrée.",
      };
    }
    sessionId = data;
    booked.push(court!);
  }

  await joinPayers(supabase, sessionId, fields.booking, userId, formData.get("i_play") === "on");
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
  const { data: session } = await supabase.from("sessions").select("venue").eq("id", sessionId).is("cancelled_at", null).maybeSingle();
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
  // Après les promotions : un payeur qui arrive ne passe pas devant la liste d'attente.
  await joinPayers(supabase, newSessionId, fields.booking, userId, false);
  await notifyGroup(supabase, userId, newSessionId, {
    kind: "added",
    courts: [court],
    startsAt: fields.booking.p_starts_at,
    endsAt: fields.booking.p_ends_at,
    payers: payers(fields.booking),
  });
  if (newSessionId !== sessionId) redirect(`/sessions/${newSessionId}`);
  refresh();
  return { added: true };
}

export async function removeBooking(bookingId: string) {
  const { supabase, userId } = await requirePlayer();
  const { data: booking } = await supabase
    .from("court_bookings")
    .select("session_id, court, starts_at, ends_at")
    .eq("id", bookingId)
    .is("cancelled_at", null)
    .maybeSingle();
  const before = booking ? await sessionState(supabase, booking.session_id) : null;
  const players = booking ? await snapshot(supabase, booking.session_id) : null;
  const { error } = await supabase.rpc("remove_court_booking", { p_booking: bookingId });
  // Moins de places : des joueurs peuvent repasser en liste d'attente (noté dans l'historique).
  if (booking && players && !error) await notifyPromotions(supabase, booking.session_id, players, userId);
  if (booking && before && !error) {
    await notifyGroup(supabase, userId, booking.session_id, {
      kind: "removed",
      courts: [booking.court],
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      before,
    });
  }
  const { data: still } = booking
    ? await supabase.from("sessions").select("id").eq("id", booking.session_id).is("cancelled_at", null).maybeSingle()
    : { data: null };
  if (!still) redirect("/");
  refresh();
}

// Change le prix d'un terrain déjà réservé (prix réel différent, remise…). Les comptes et la part
// de chacun sont recalculés à partir des prix : rien d'autre à mettre à jour.
export async function updateBookingPrice(bookingId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requirePlayer();
  const priceCents = parseEurosToCents(String(formData.get("price") ?? ""));
  if (priceCents === null) return { error: "Le prix doit être un montant en euros, par exemple 12,50." };
  if (priceCents > MAX_PRICE_CENTS) return { error: "Le prix d'un terrain ne peut pas dépasser 1 000 €." };
  // Un montant saisi remplace le tarif carte : les deux payeurs avancent alors la moitié chacun.
  const { data, error } = await supabase
    .from("court_bookings")
    .update({ price_cents: priceCents, card_pricing: false })
    .eq("id", bookingId)
    .is("cancelled_at", null)
    .select("id");
  if (error) return { error: "Le prix n'a pas pu être modifié." };
  if (!data?.length) return { error: "Ce terrain n'existe plus." };
  refresh();
  return { added: true };
}

type Payers = { booked_by: string; co_payer: string | null; booked_by_card: boolean; co_payer_card: boolean };

// Change les payeurs d'un terrain déjà réservé. Au tarif carte, le prix est recalculé
// (seul, le capitaine paie le supplément du partenaire absent) ; sinon il ne change pas.
// Un nouveau payeur est inscrit à la session, comme à la réservation.
async function savePayers(bookingId: string, payers: Payers): Promise<FormState> {
  const { supabase } = await requirePlayer();
  const { data: booking } = await supabase
    .from("court_bookings")
    .select("session_id, starts_at, ends_at, card_pricing, booked_by, co_payer")
    .eq("id", bookingId)
    .is("cancelled_at", null)
    .maybeSingle();
  if (!booking) return { error: "Ce terrain n'existe plus." };
  if (payers.co_payer === payers.booked_by) return { error: "Choisissez deux payeurs différents." };
  const coPayerCard = payers.co_payer !== null && payers.co_payer_card;
  const minutes = (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60000;
  const price = booking.card_pricing
    ? { price_cents: cardPrice({ captainCard: payers.booked_by_card, partner: payers.co_payer !== null, partnerCard: coPayerCard }, minutes).total }
    : {};
  const { error } = await supabase
    .from("court_bookings")
    .update({ ...payers, co_payer_card: coPayerCard, ...price })
    .eq("id", bookingId);
  if (error) return { error: "Les payeurs n'ont pas pu être modifiés." };
  const added = [payers.booked_by, payers.co_payer].filter(
    (id): id is string => id !== null && id !== booking.booked_by && id !== booking.co_payer,
  );
  if (added.length) {
    await supabase.rpc("add_participants", { p_session: booking.session_id, p_players: added });
  }
  refresh();
  return { added: true };
}

// Formulaire « Modifier les payeurs » de l'écran Gérer.
export async function updateBookingPayers(bookingId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const bookedBy = String(formData.get("booked_by") ?? "");
  if (!bookedBy) return { error: "Choisissez le capitaine." };
  const coPayer = String(formData.get("co_payer") ?? "") || null;
  return savePayers(bookingId, {
    booked_by: bookedBy,
    co_payer: coPayer,
    booked_by_card: formData.get("booked_by_card") === "on",
    co_payer_card: formData.get("co_payer_card") === "on",
  });
}

// Le 2e joueur annule sa réservation sur le site du gymnase : le capitaine reste seul et,
// au tarif carte, paie le supplément du partenaire absent. (Si le capitaine annule, le gymnase
// annule le terrain : on le retire.)
export async function removePartner(bookingId: string) {
  const { supabase } = await requirePlayer();
  const { data: b } = await supabase
    .from("court_bookings")
    .select("booked_by, co_payer, booked_by_card")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b?.co_payer) return;
  await savePayers(bookingId, { booked_by: b.booked_by, co_payer: null, booked_by_card: b.booked_by_card, co_payer_card: false });
}

export async function updateSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requirePlayer();
  const id = String(formData.get("id") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!venue) return { error: "Indiquez le gymnase." };
  if (venue.length > MAX_VENUE) return { error: `Nom du gymnase : ${MAX_VENUE} caractères maximum.` };
  if (notes && notes.length > MAX_NOTES) return { error: `Note : ${MAX_NOTES} caractères maximum.` };
  const { error } = await supabase.from("sessions").update({ venue, notes }).eq("id", id);
  if (error) return { error: "La modification n'a pas pu être enregistrée." };
  // Le bouton OK de l'écran Gérer enregistre puis revient à la session.
  if (formData.get("done")) redirect(`/sessions/${id}`);
  refresh();
  return { added: true };
}

// La session est annulée, pas supprimée : elle reste en base avec ses terrains, ses inscriptions
// et ses QR codes (seul son créateur peut l'annuler, règle vérifiée en base).
export async function deleteSession(id: string) {
  const { supabase, userId } = await requirePlayer();
  const before = await sessionState(supabase, id);
  const { data, error } = await supabase
    .from("sessions")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .is("cancelled_at", null)
    .select("id");
  if (before && !error && data?.length) await notifyGroup(supabase, userId, id, { kind: "deleted", before });
  redirect("/");
}

// Inscrit un joueur (lui-même ou un autre depuis la page de la session) et prévient le groupe.
export async function addParticipant(sessionId: string, playerId: string, guests = 0) {
  const { supabase } = await requirePlayer();
  const { data: added } = await supabase.rpc("add_participants", { p_session: sessionId, p_players: [playerId], p_guests: guests });
  // Rien de renvoyé = le joueur était déjà inscrit : pas de nouveau message.
  if (added?.length) {
    const { data: me } = await supabase
      .from("session_players")
      .select("is_playing")
      .eq("session_id", sessionId)
      .eq("player_id", playerId)
      .maybeSingle();
    await notifyGroup(supabase, playerId, sessionId, { kind: "joined", guests, playing: me?.is_playing ?? true });
  }
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
    .eq("player_id", userId)
    .is("left_at", null);
  if (error) return { error: "Le nombre d'invités n'a pas pu être modifié." };
  // Moins d'invités = des places libérées pour la liste d'attente.
  await notifyPromotions(supabase, sessionId, before, userId);
  // Le groupe voit les places restantes avec les invités ajoutés ou retirés.
  if (guests !== me.guests) {
    const { data: now } = await supabase
      .from("session_players")
      .select("is_playing")
      .eq("session_id", sessionId)
      .eq("player_id", userId)
      .maybeSingle();
    await notifyGroup(supabase, userId, sessionId, { kind: "guests", guests, playing: now?.is_playing ?? true });
  }
  refresh();
  return {};
}

// Désinscription : l'inscription est marquée comme quittée (jamais supprimée), le groupe est
// prévenu, le premier de la liste d'attente prend la place et reçoit un e-mail.
export async function removeParticipant(sessionId: string, playerId: string) {
  const { supabase, userId } = await requirePlayer();
  const before = await snapshot(supabase, sessionId);
  const { data: removed } = await supabase
    .from("session_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("player_id", playerId)
    .is("left_at", null)
    .select("guests");
  // Rien de renvoyé = le joueur n'était plus inscrit : pas de message.
  if (removed?.length) {
    await notifyGroup(supabase, playerId, sessionId, {
      kind: "left",
      guests: removed[0].guests,
      playing: before.playing.has(playerId),
    });
  }
  await notifyPromotions(supabase, sessionId, before, userId);
  refresh();
}

// Depuis la liste déroulante « Inscrire un joueur » de la page d'une session.
export async function addParticipantFromForm(sessionId: string, formData: FormData) {
  const playerId = String(formData.get("player_id") ?? "");
  if (playerId) await addParticipant(sessionId, playerId);
}

// QR code d'une heure d'un terrain (hour = 0 pour la première heure) ; path = null le retire.
// Un QR code retiré reste en base (removed_at) et son image reste dans le stockage.
export async function setQrPath(bookingId: string, hour: number, path: string | null) {
  const { supabase } = await requirePlayer();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
  if (path) await supabase.from("booking_qr_codes").upsert({ booking_id: bookingId, hour, qr_path: path, removed_at: null });
  else await supabase.from("booking_qr_codes").update({ removed_at: new Date().toISOString() }).eq("booking_id", bookingId).eq("hour", hour);
  refresh();
}
