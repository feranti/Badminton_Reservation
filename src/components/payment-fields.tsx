"use client";

import { useState } from "react";
import { cardPrice, defaultCourtPriceCents, isCardVenue, slotMinutes } from "@/lib/courts";
import type { Player } from "@/lib/data";
import { formatEuros, formatPriceInput, parseEurosToCents } from "@/lib/format";
import { inputClass, labelClass, textButton } from "./ui";

// Qui a réservé un terrain et combien il coûte.
// Au Prisme : tarif « carte 10 sessions », calculé à partir du capitaine, du 2e joueur et de
// leurs cartes. Ailleurs (ou sur demande) : un montant saisi, partagé à moitié à deux payeurs.
type Payment = {
  bookedBy: string;
  captainCard: boolean;
  partnerOpen: boolean;
  partner: string;
  partnerCard: boolean;
  custom: boolean;
  typedPrice: string | null;
};

const initial = (userId: string): Payment => ({
  bookedBy: userId,
  captainCard: true,
  partnerOpen: false,
  partner: "",
  partnerCard: true,
  custom: false,
  typedPrice: null,
});

export function usePayment(userId: string, slot: { venue: string; start: string; end: string }) {
  const [payment, setPayment] = useState(() => initial(userId));
  const minutes = slotMinutes(slot.start, slot.end);
  const cardVenue = isCardVenue(slot.venue);
  const cardMode = cardVenue && !payment.custom;
  const card =
    minutes === null
      ? null
      : cardPrice({ captainCard: payment.captainCard, partner: Boolean(payment.partner), partnerCard: payment.partnerCard }, minutes);
  // Tant que le joueur n'a pas saisi de montant, il suit le créneau (tarif carte au Prisme, 9 € l'heure ailleurs).
  const suggested = cardVenue ? (card?.total ?? null) : defaultCourtPriceCents(slot.start, slot.end);
  const priceInput = payment.typedPrice ?? (suggested === null ? "" : formatPriceInput(suggested));
  const priceCents = cardMode ? (card?.total ?? null) : parseEurosToCents(priceInput);
  return {
    payment,
    update: (change: Partial<Payment>) => setPayment((p) => ({ ...p, ...change })),
    reset: () => setPayment(initial(userId)),
    minutes,
    cardVenue,
    cardMode,
    card,
    priceInput,
    priceCents,
  };
}

const pill = (on: boolean) =>
  `flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm ${
    on ? "border-accent bg-accent-tint font-semibold text-accent-ink" : "border-edge bg-surface text-muted"
  }`;

export function PaymentFields({
  players,
  userId,
  value,
  priceLabel = "Prix par terrain (€)",
}: {
  players: Player[];
  userId: string;
  value: ReturnType<typeof usePayment>;
  priceLabel?: string;
}) {
  const { payment: p, update, cardMode, cardVenue, card, minutes, priceInput } = value;
  const name = (id: string) => (id === userId ? "Moi" : (players.find((pl) => pl.id === id)?.display_name ?? "?"));
  const options = players.map((pl) => (
    <option key={pl.id} value={pl.id}>
      {pl.id === userId ? "Moi" : pl.display_name}
    </option>
  ));
  const partnerSelect = (label: string) => (
    <select
      name="co_payer"
      value={p.partner}
      onChange={(e) => update({ partner: e.target.value })}
      aria-label={label}
      className={`${inputClass} min-w-0 flex-1`}
    >
      <option value="">Personne</option>
      {options}
    </select>
  );

  if (!cardMode) {
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            {priceLabel}
            <input
              name="price"
              required
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => update({ typedPrice: e.target.value })}
              className={inputClass}
              placeholder="12,50"
            />
          </label>
          <label className={labelClass}>
            Payé par
            <select name="booked_by" value={p.bookedBy} onChange={(e) => update({ bookedBy: e.target.value })} className={inputClass}>
              {options}
            </select>
          </label>
        </div>
        {p.partnerOpen ? (
          <label className={labelClass}>
            Partagé avec (moitié chacun)
            {partnerSelect("Partagé avec")}
          </label>
        ) : (
          <button type="button" onClick={() => update({ partnerOpen: true })} className={`${textButton} self-start`}>
            + Partager le paiement
          </button>
        )}
        {cardVenue && (
          <button type="button" onClick={() => update({ custom: false, typedPrice: null })} className={`${textButton} self-start`}>
            Revenir au tarif carte 10 sessions
          </button>
        )}
      </div>
    );
  }

  const perHour = (cents: number) => (minutes && minutes !== 60 ? ` · ${formatEuros(Math.round((cents * 60) / minutes))}/h` : "");
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2.5 text-sm font-medium text-muted">Qui a réservé sur le site du gymnase</legend>
      <input type="hidden" name="card_pricing" value="on" />
      <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 p-2.5">
          <span className="w-20 shrink-0 text-sm leading-tight">
            Capitaine
            <span className="block text-xs text-faint">a réservé en premier</span>
          </span>
          <select
            name="booked_by"
            value={p.bookedBy}
            onChange={(e) => update({ bookedBy: e.target.value })}
            aria-label="Capitaine"
            className={`${inputClass} min-w-0 flex-1`}
          >
            {options}
          </select>
          <label className={pill(p.captainCard)}>
            <input
              type="checkbox"
              name="booked_by_card"
              checked={p.captainCard}
              onChange={(e) => update({ captainCard: e.target.checked })}
              aria-label="Carte 10 sessions du capitaine"
              className="size-4 accent-accent"
            />
            Carte
          </label>
        </div>
        {p.partnerOpen ? (
          <div className="flex items-center gap-2 p-2.5">
            <span className="w-20 shrink-0 text-sm">2e joueur</span>
            {partnerSelect("2e joueur")}
            <label className={pill(p.partnerCard)}>
              <input
                type="checkbox"
                name="co_payer_card"
                checked={p.partnerCard}
                onChange={(e) => update({ partnerCard: e.target.checked })}
                aria-label="Carte 10 sessions du 2e joueur"
                className="size-4 accent-accent"
              />
              Carte
            </label>
          </div>
        ) : (
          <button type="button" onClick={() => update({ partnerOpen: true })} className={`${textButton} px-2.5`}>
            + Ajouter le 2e joueur
          </button>
        )}
      </div>
      {card && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-accent-tint px-3.5 py-2.5 text-sm text-accent-ink" aria-label="Détail du prix">
          <span className="flex justify-between gap-2">
            <span>
              {name(p.bookedBy)} ({p.captainCard ? "carte" : "sans carte"})
            </span>
            <span>{formatEuros(card.captain)}</span>
          </span>
          <span className="flex justify-between gap-2">
            <span>
              {p.partner ? `${name(p.partner)} (${p.partnerCard ? "carte" : "sans carte"})` : "Supplément : 2e joueur absent"}
            </span>
            <span>{formatEuros(card.second)}</span>
          </span>
          <span className="mt-1 flex justify-between gap-2 text-[15px] font-semibold">
            <span>Par terrain</span>
            <span>
              {formatEuros(card.total)}
              {perHour(card.total)}
            </span>
          </span>
        </div>
      )}
      <p className="text-sm text-muted">
        Autre tarif ?{" "}
        <button type="button" onClick={() => update({ custom: true, typedPrice: null })} className={textButton}>
          Saisir un montant
        </button>
      </p>
    </fieldset>
  );
}
