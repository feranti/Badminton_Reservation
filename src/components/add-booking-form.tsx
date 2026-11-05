"use client";

import { useEffect, useRef, useState } from "react";
import { addBooking, type FormState } from "@/app/sessions/actions";
import { COURTS } from "@/lib/courts";
import type { Player } from "@/lib/data";
import { PaymentFields, usePayment } from "./payment-fields";
import { errorText, inputClass, labelClass, primaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

// Ajoute une réservation (un terrain sur un créneau) à une session existante.
export function AddBookingForm({
  sessionId,
  venue,
  date,
  start,
  end,
  players,
  userId,
}: {
  sessionId: string;
  venue: string;
  date: string;
  start: string;
  end: string;
  players: Player[];
  userId: string;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(addBooking.bind(null, sessionId), {});
  const formRef = useRef<HTMLFormElement>(null);
  const [slot, setSlot] = useState({ start, end });
  const payment = usePayment(userId, { ...slot, venue });

  // Terrain ajouté : le créneau et le prix reviennent à leurs valeurs par défaut.
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.added) {
      setSlot({ start, end });
      payment.reset();
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
      <PaymentFields players={players} userId={userId} value={payment} priceLabel="Prix (€)" />
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
