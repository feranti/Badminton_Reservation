"use client";

import { useEffect, useRef, useState } from "react";
import { addBooking, type FormState } from "@/app/sessions/actions";
import { COURTS, defaultCourtPriceCents } from "@/lib/courts";
import type { Player } from "@/lib/data";
import { formatPriceInput } from "@/lib/format";
import { PayerFields } from "./payer-fields";
import { errorText, inputClass, labelClass, primaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

// Ajoute une réservation (un terrain sur un créneau) à une session existante.
export function AddBookingForm({
  sessionId,
  date,
  start,
  end,
  players,
  userId,
}: {
  sessionId: string;
  date: string;
  start: string;
  end: string;
  players: Player[];
  userId: string;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(addBooking.bind(null, sessionId), {});
  const formRef = useRef<HTMLFormElement>(null);
  const [slot, setSlot] = useState({ start, end });
  // Tant que le joueur n'a pas saisi de prix, il suit la durée du créneau (9 € l'heure).
  const [typedPrice, setTypedPrice] = useState<string | null>(null);
  const slotPrice = defaultCourtPriceCents(slot.start, slot.end);
  const price = typedPrice ?? (slotPrice === null ? "" : formatPriceInput(slotPrice));

  // Terrain ajouté : le créneau et le prix reviennent à leurs valeurs par défaut.
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.added) {
      setSlot({ start, end });
      setTypedPrice(null);
    }
  }

  useEffect(() => {
    if (state.added) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} aria-label="Ajouter un terrain" className="flex flex-col gap-4 pt-2">
      <input type="hidden" name="date" value={date} />
      <div className="grid grid-cols-3 gap-2">
        <label className={labelClass}>
          Terrain
          <select name="court" required className={inputClass} defaultValue="">
            <option value="" disabled>
              N°
            </option>
            {COURTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Début
          <input type="time" name="start" required value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} className={inputClass} />
        </label>
        <label className={labelClass}>
          Fin
          <input type="time" name="end" required value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} className={inputClass} />
        </label>
      </div>
      <PayerFields players={players} userId={userId}>
        <label className={labelClass}>
          Prix
          <input
            name="price"
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => setTypedPrice(e.target.value)}
            placeholder="9,00"
            className={inputClass}
          />
        </label>
      </PayerFields>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Ajout…" : "Ajouter le terrain"}
      </button>
    </form>
  );
}
