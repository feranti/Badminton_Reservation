"use client";

import { useState } from "react";
import { updateBookingPayers, type FormState } from "@/app/sessions/actions";
import type { Player } from "@/lib/data";
import { errorText, inputClass, secondaryButton, textButton } from "./ui";
import { useFormAction } from "./use-form-action";

// Payeurs d'un terrain déjà réservé : capitaine, 2e joueur et, au tarif carte, leurs cartes.
// Au tarif carte, le prix est recalculé à l'enregistrement. Remonté (key) après chaque changement.
export function EditPayersForm({
  bookingId,
  label,
  players,
  userId,
  cardPricing,
  bookedBy,
  coPayer,
  bookedByCard,
  coPayerCard,
}: {
  bookingId: string;
  label: string;
  players: Player[];
  userId: string;
  cardPricing: boolean;
  bookedBy: string;
  coPayer: string | null;
  bookedByCard: boolean;
  coPayerCard: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(updateBookingPayers.bind(null, bookingId), {});
  const [partner, setPartner] = useState(coPayer ?? "");
  const options = players.map((p) => (
    <option key={p.id} value={p.id}>
      {p.id === userId ? "Moi" : p.display_name}
    </option>
  ));
  const card = (name: string, checked: boolean, who: string) =>
    cardPricing && (
      <label className="flex min-h-11 shrink-0 items-center gap-1.5 text-sm text-muted">
        <input type="checkbox" name={name} defaultChecked={checked} aria-label={`Carte 10 sessions du ${who} · ${label}`} className="size-4 accent-accent" />
        Carte
      </label>
    );

  return (
    <details className="group">
      <summary className={`${textButton} cursor-pointer`}>Modifier les payeurs</summary>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-sm text-muted">{cardPricing ? "Capitaine" : "Payé par"}</span>
          <select name="booked_by" defaultValue={bookedBy} aria-label={`Capitaine · ${label}`} className={`${inputClass} min-w-0 flex-1`}>
            {options}
          </select>
          {card("booked_by_card", bookedByCard, "capitaine")}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-sm text-muted">{cardPricing ? "2e joueur" : "Partagé avec"}</span>
          <select
            name="co_payer"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
            aria-label={`2e joueur · ${label}`}
            className={`${inputClass} min-w-0 flex-1`}
          >
            <option value="">Personne</option>
            {options}
          </select>
          {partner && card("co_payer_card", coPayer ? coPayerCard : true, "2e joueur")}
        </div>
        <button type="submit" disabled={pending} className={`${secondaryButton} self-start`}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {state.error && (
          <p role="alert" className={errorText}>
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
