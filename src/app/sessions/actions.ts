"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { cardPrice, COURTS, MAX_GUESTS } from "@/lib/courts";
import { attempt, type Db, UUID } from "@/lib/db";
import type { Tables } from "@/lib/database.types";
import { parisToIso, parseEurosToCents } from "@/lib/format";
import { QR_MAX_BYTES, QR_TYPES, sniffQrType } from "@/lib/qr-image";
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

type BookingFields = Extract<ReturnType<typeof readBooking>, { booking: unknown }>["booking"];

// Fonctions de la base (supabase/migrations) : elles vérifient elles-mêmes le joueur (auth.uid()).
async function addCourtBooking(db: Db, booking: BookingFields, venue: string, court: number) {
  const b = booking;
  const [row] = await db<{ id: string }>`
    select public.add_court_booking(
      p_venue => ${venue}, p_court => ${court}::smallint, p_starts_at => ${b.p_starts_at}::timestamptz,
      p_ends_at => ${b.p_ends_at}::timestamptz, p_price_cents => ${b.p_price_cents}::integer,
      p_booked_by => ${b.p_booked_by}::uuid, p_co_payer => ${b.p_co_payer}::uuid,
      p_card_pricing => ${b.p_card_pricing}, p_booked_by_card => ${b.p_booked_by_card}, p_co_payer_card => ${b.p_co_payer_card}
    ) as id`;
  return row.id;
}

// Renvoie les joueurs vraiment ajoutés (rien pour un joueur déjà inscrit).
async function addParticipants(db: Db, sessionId: string, players: string[], guests = 0) {
  const rows = await db<{ id: string }>`
    select id from public.add_participants(${sessionId}::uuid, ${players}::uuid[], ${guests}::smallint) as id`;
  return rows.map((r) => r.id);
}

// Payeur de la réservation, puis le second payeur s'il y en a un.
function payers(booking: { p_booked_by: string; p_co_payer: string | null }) {
  return booking.p_co_payer ? [booking.p_booked_by, booking.p_co_payer] : [booking.p_booked_by];
}

// Inscrit les payeurs de la réservation (sauf la personne qui la saisit, qui choisit avec « Je joue »)
// et, s'il joue, le joueur connecté. Un joueur déjà inscrit garde sa place et ses invités.
async function joinPayers(
  db: Db,
  sessionId: string,
  booking: { p_booked_by: string; p_co_payer: string | null },
  userId: string,
  iPlay: boolean,
) {
  const ids = [...new Set([...(iPlay ? [userId] : []), ...payers(booking).filter((id) => id !== userId)])];
  if (ids.length === 0) return;
  const { error } = await attempt(addParticipants(db, sessionId, ids));
  if (error) console.error("[inscription] payeurs non inscrits", error);
}

// Ajoute une ou plusieurs réservations (un terrain chacune). L'appli les range dans la bonne session.
export async function createBookings(_prev: FormState, formData: FormData): Promise<FormState> {
  const { db, userId } = await requirePlayer();
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
    notifyGroup(db, userId, sessionId, {
      kind: "added",
      courts: booked,
      startsAt: fields.booking.p_starts_at,
      endsAt: fields.booking.p_ends_at,
      payers: payers(fields.booking),
    });
  for (const court of courts) {
    const { data, error } = await attempt(addCourtBooking(db, fields.booking, venue, court!));
    if (error) {
      if (sessionId) await joinPayers(db, sessionId, fields.booking, userId, formData.get("i_play") === "on");
      await notify();
      return {
        error: "code" in error && error.code === "23505" ? `Le terrain ${court} est déjà réservé sur ce créneau.` : "La réservation n'a pas pu être enregistrée.",
      };
    }
    sessionId = data;
    booked.push(court!);
  }

  await joinPayers(db, sessionId, fields.booking, userId, formData.get("i_play") === "on");
  await notify();
  redirect(`/sessions/${sessionId}`);
}

// Ajoute une réservation depuis la page d'une session (même lieu, même jour).
export async function addBooking(sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { db, userId } = await requirePlayer();
  const court = readCourt(formData.get("court"));
  if (court === null) return { error: "Choisissez un terrain." };
  const fields = readBooking(formData, userId);
  if ("error" in fields) return { error: fields.error };
  const [session] = await db<{ venue: string }>`select venue from public.sessions where id = ${sessionId} and cancelled_at is null`;
  if (!session) return { error: "Cette session n'existe plus." };

  const before = await snapshot(db, sessionId);
  const { data: newSessionId, error } = await attempt(addCourtBooking(db, fields.booking, session.venue, court));
  if (error) {
    return { error: "code" in error && error.code === "23505" ? `Le terrain ${court} est déjà réservé sur ce créneau.` : "La réservation n'a pas pu être ajoutée." };
  }
  // Plus de terrains = plus de places : des joueurs en attente peuvent passer joueurs.
  await notifyPromotions(db, newSessionId, before, userId);
  // Après les promotions : un payeur qui arrive ne passe pas devant la liste d'attente.
  await joinPayers(db, newSessionId, fields.booking, userId, false);
  await notifyGroup(db, userId, newSessionId, {
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
  const { db, userId } = await requirePlayer();
  const [booking] = await db<{ session_id: string; court: number; starts_at: string; ends_at: string }>`
    select session_id, court, starts_at, ends_at from public.court_bookings
    where id = ${bookingId} and cancelled_at is null`;
  const before = booking ? await sessionState(db, booking.session_id) : null;
  const players = booking ? await snapshot(db, booking.session_id) : null;
  const { error } = await attempt(db`select public.remove_court_booking(${bookingId}::uuid)`);
  // Moins de places : des joueurs peuvent repasser en liste d'attente (noté dans l'historique).
  if (booking && players && !error) await notifyPromotions(db, booking.session_id, players, userId);
  if (booking && before && !error) {
    await notifyGroup(db, userId, booking.session_id, {
      kind: "removed",
      courts: [booking.court],
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      before,
    });
  }
  const [still] = booking
    ? await db`select id from public.sessions where id = ${booking.session_id} and cancelled_at is null`
    : [];
  if (!still) redirect("/");
  refresh();
}

// Change le prix d'un terrain déjà réservé (prix réel différent, remise…). Les comptes et la part
// de chacun sont recalculés à partir des prix : rien d'autre à mettre à jour.
export async function updateBookingPrice(bookingId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { db } = await requirePlayer();
  const priceCents = parseEurosToCents(String(formData.get("price") ?? ""));
  if (priceCents === null) return { error: "Le prix doit être un montant en euros, par exemple 12,50." };
  if (priceCents > MAX_PRICE_CENTS) return { error: "Le prix d'un terrain ne peut pas dépasser 1 000 €." };
  // Un montant saisi remplace le tarif carte : les deux payeurs avancent alors la moitié chacun.
  const { data, error } = await attempt(db`
    update public.court_bookings set price_cents = ${priceCents}, card_pricing = false
    where id = ${bookingId} and cancelled_at is null
    returning id`);
  if (error) return { error: "Le prix n'a pas pu être modifié." };
  if (!data.length) return { error: "Ce terrain n'existe plus." };
  refresh();
  return { added: true };
}

type Payers = { booked_by: string; co_payer: string | null; booked_by_card: boolean; co_payer_card: boolean };

// Change les payeurs d'un terrain déjà réservé. Au tarif carte, le prix est recalculé
// (seul, le capitaine paie le supplément du partenaire absent) ; sinon il ne change pas.
// Un nouveau payeur est inscrit à la session, comme à la réservation.
async function savePayers(bookingId: string, payers: Payers): Promise<FormState> {
  const { db } = await requirePlayer();
  const [booking] = await db<Pick<Tables<"court_bookings">, "session_id" | "starts_at" | "ends_at" | "card_pricing" | "booked_by" | "co_payer">>`
    select session_id, starts_at, ends_at, card_pricing, booked_by, co_payer from public.court_bookings
    where id = ${bookingId} and cancelled_at is null`;
  if (!booking) return { error: "Ce terrain n'existe plus." };
  if (payers.co_payer === payers.booked_by) return { error: "Choisissez deux payeurs différents." };
  const coPayerCard = payers.co_payer !== null && payers.co_payer_card;
  const minutes = (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60000;
  const price = booking.card_pricing
    ? cardPrice({ captainCard: payers.booked_by_card, partner: payers.co_payer !== null, partnerCard: coPayerCard }, minutes).total
    : null;
  // Le prix n'est écrit que s'il est recalculé : l'historique note chaque colonne modifiée.
  const { error } = await attempt(
    price === null
      ? db`
          update public.court_bookings
          set booked_by = ${payers.booked_by}, co_payer = ${payers.co_payer}, booked_by_card = ${payers.booked_by_card}, co_payer_card = ${coPayerCard}
          where id = ${bookingId}`
      : db`
          update public.court_bookings
          set booked_by = ${payers.booked_by}, co_payer = ${payers.co_payer}, booked_by_card = ${payers.booked_by_card}, co_payer_card = ${coPayerCard},
              price_cents = ${price}
          where id = ${bookingId}`,
  );
  if (error) return { error: "Les payeurs n'ont pas pu être modifiés." };
  const added = [payers.booked_by, payers.co_payer].filter(
    (id): id is string => id !== null && id !== booking.booked_by && id !== booking.co_payer,
  );
  if (added.length) {
    const { error } = await attempt(addParticipants(db, booking.session_id, added));
    if (error) console.error("[inscription] nouveaux payeurs non inscrits", error);
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
  const { db } = await requirePlayer();
  const [b] = await db<{ booked_by: string; co_payer: string | null; booked_by_card: boolean }>`
    select booked_by, co_payer, booked_by_card from public.court_bookings where id = ${bookingId}`;
  if (!b?.co_payer) return;
  await savePayers(bookingId, { booked_by: b.booked_by, co_payer: null, booked_by_card: b.booked_by_card, co_payer_card: false });
}

export async function updateSession(_prev: FormState, formData: FormData): Promise<FormState> {
  const { db } = await requirePlayer();
  const id = String(formData.get("id") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!venue) return { error: "Indiquez le gymnase." };
  if (venue.length > MAX_VENUE) return { error: `Nom du gymnase : ${MAX_VENUE} caractères maximum.` };
  if (notes && notes.length > MAX_NOTES) return { error: `Note : ${MAX_NOTES} caractères maximum.` };
  const { error } = await attempt(db`update public.sessions set venue = ${venue}, notes = ${notes} where id = ${id}`);
  if (error) return { error: "La modification n'a pas pu être enregistrée." };
  // Le bouton OK de l'écran Gérer enregistre puis revient à la session.
  if (formData.get("done")) redirect(`/sessions/${id}`);
  refresh();
  return { added: true };
}

// La session est annulée, pas supprimée : elle reste en base avec ses terrains, ses inscriptions
// et ses QR codes (seul son créateur peut l'annuler, règle vérifiée en base).
export async function deleteSession(id: string) {
  const { db, userId } = await requirePlayer();
  const before = await sessionState(db, id);
  const { data } = await attempt(db`
    update public.sessions set cancelled_at = now() where id = ${id} and cancelled_at is null returning id`);
  if (before && data?.length) await notifyGroup(db, userId, id, { kind: "deleted", before });
  redirect("/");
}

// Inscrit un joueur (lui-même ou un autre depuis la page de la session) et prévient le groupe.
export async function addParticipant(sessionId: string, playerId: string, guests = 0) {
  const { db } = await requirePlayer();
  const { data: added, error } = await attempt(addParticipants(db, sessionId, [playerId], guests));
  if (error) console.error("[inscription] impossible", error);
  // Rien de renvoyé = le joueur était déjà inscrit : pas de nouveau message.
  if (added?.length) {
    const [me] = await db<{ is_playing: boolean; guests_waiting: number }>`
      select is_playing, guests_waiting from public.session_players where session_id = ${sessionId} and player_id = ${playerId}`;
    await notifyGroup(db, playerId, sessionId, {
      kind: "joined",
      guests,
      playing: me?.is_playing ?? true,
      guestsWaiting: me?.guests_waiting ?? 0,
    });
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

// Change le nombre d'invités du joueur connecté. Un invité ajouté alors que la session est pleine
// va en fin de liste d'attente (règle de la vue session_players) : il ne prend la place de personne.
export async function setGuests(sessionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { db, userId } = await requirePlayer();
  const guests = readGuests(formData);
  if (guests === null) return { error: "Nombre d'invités incorrect." };
  const [me] = await db<{ guests: number }>`
    select guests from public.session_players where session_id = ${sessionId} and player_id = ${userId}`;
  if (!me) return { error: "Vous n'êtes plus inscrit à cette session." };

  const before = await snapshot(db, sessionId);
  const { error } = await attempt(db`
    update public.session_participants set guests = ${guests}
    where session_id = ${sessionId} and player_id = ${userId} and left_at is null`);
  if (error) return { error: "Le nombre d'invités n'a pas pu être modifié." };
  // Moins d'invités = des places libérées pour la liste d'attente.
  await notifyPromotions(db, sessionId, before, userId);
  // Le groupe voit les places restantes avec les invités ajoutés ou retirés.
  if (guests !== me.guests) {
    const [now] = await db<{ is_playing: boolean; guests_waiting: number }>`
      select is_playing, guests_waiting from public.session_players where session_id = ${sessionId} and player_id = ${userId}`;
    await notifyGroup(db, userId, sessionId, {
      kind: "guests",
      guests,
      playing: now?.is_playing ?? true,
      guestsWaiting: now?.guests_waiting ?? 0,
    });
  }
  refresh();
  return {};
}

// Désinscription : l'inscription est marquée comme quittée (jamais supprimée), le groupe est
// prévenu, le premier de la liste d'attente prend la place et reçoit un e-mail.
export async function removeParticipant(sessionId: string, playerId: string) {
  const { db, userId } = await requirePlayer();
  const before = await snapshot(db, sessionId);
  const { data: removed } = await attempt(db<{ guests: number }>`
    update public.session_participants set left_at = now()
    where session_id = ${sessionId} and player_id = ${playerId} and left_at is null
    returning guests`);
  // Rien de renvoyé = le joueur n'était plus inscrit : pas de message.
  if (removed?.length) {
    await notifyGroup(db, playerId, sessionId, {
      kind: "left",
      guests: removed[0].guests,
      playing: before.playing.has(playerId),
    });
  }
  await notifyPromotions(db, sessionId, before, userId);
  refresh();
}

// Depuis la liste déroulante « Inscrire un joueur » de la page d'une session.
export async function addParticipantFromForm(sessionId: string, formData: FormData) {
  const playerId = String(formData.get("player_id") ?? "");
  if (playerId) await addParticipant(sessionId, playerId);
}

// QR code d'une heure d'un terrain (hour = 0 pour la première heure), envoyé depuis la page de
// la session ou le menu « Partager » du téléphone. L'image va dans la base (qr_images) et le QR
// code de l'heure la désigne, dans la même transaction. Renvoie false si l'envoi est refusé.
export async function uploadQr(formData: FormData) {
  const { db } = await requirePlayer();
  const bookingId = String(formData.get("booking_id") ?? "");
  const hour = Number(formData.get("hour"));
  const file = formData.get("file");
  if (!UUID.test(bookingId) || !Number.isInteger(hour) || hour < 0 || hour > 23) return false;
  if (!(file instanceof File) || file.size === 0 || file.size > QR_MAX_BYTES) return false;
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffQrType(data);
  if (!type) return false;
  const path = `${bookingId}/${hour}-${Date.now()}.${QR_TYPES[type]}`;
  const { error } = await attempt(
    db.tx(async (tx) => {
      await tx`insert into public.qr_images (path, content_type, data) values (${path}, ${type}, ${data})`;
      await tx`
        insert into public.booking_qr_codes (booking_id, hour, qr_path, removed_at) values (${bookingId}, ${hour}, ${path}, null)
        on conflict (booking_id, hour) do update set qr_path = excluded.qr_path, removed_at = null`;
    }),
  );
  if (error) {
    console.error("[QR code] non enregistré", error);
    return false;
  }
  refresh();
  return true;
}

// Retire le QR code d'une heure. Il reste en base (removed_at), son image aussi.
export async function removeQr(bookingId: string, hour: number) {
  const { db } = await requirePlayer();
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
  const { error } = await attempt(
    db`update public.booking_qr_codes set removed_at = now() where booking_id = ${bookingId} and hour = ${hour}`,
  );
  if (error) console.error("[QR code] non retiré", error);
  refresh();
}
