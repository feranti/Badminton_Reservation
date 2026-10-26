"use client";

import { useEffect, useRef, useState } from "react";
import { joinSession, setGuests, type FormState } from "@/app/sessions/actions";
import { MAX_GUESTS } from "@/lib/courts";
import { errorText, inputClass, primaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

const COUNTS = Array.from({ length: MAX_GUESTS + 1 }, (_, i) => i);

function guestsLabel(n: number) {
  return n === 0 ? "aucun invité" : `${n} invité${n > 1 ? "s" : ""}`;
}

// Inscription, seul ou avec des invités extérieurs (+1, +2…). Le groupe joue ou attend ensemble.
export function JoinForm({ sessionId, free }: { sessionId: string; free: number }) {
  const { state, pending, onSubmit } = useFormAction<FormState>(joinSession.bind(null, sessionId), {});
  const [guests, setCount] = useState(0);
  const fits = free >= 1 + guests;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      {free > 0 && !fits && (
        <p className="text-center text-sm text-warn">
          Il reste {free} place{free > 1 ? "s" : ""} : vous et vos invités passerez ensemble en liste d&apos;attente.
        </p>
      )}
      {state.error && (
        <p role="alert" className={`${errorText} text-center`}>
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <select
          name="guests"
          value={guests}
          onChange={(e) => setCount(Number(e.target.value))}
          aria-label="Invités extérieurs"
          className={`${inputClass} min-h-13 w-auto shrink-0`}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Seul" : `+${n}`}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={`${primaryButton} min-h-13 flex-1 text-base`}>
          {fits ? (guests > 0 ? `Je m'inscris +${guests}` : "Je m'inscris") : "M'inscrire en liste d'attente"}
        </button>
      </div>
    </form>
  );
}

// Nombre d'invités d'un joueur déjà inscrit, enregistré dès qu'il change.
export function GuestsForm({ sessionId, guests }: { sessionId: string; guests: number }) {
  const { state, pending, onSubmit } = useFormAction<FormState>(setGuests.bind(null, sessionId), {});
  const select = useRef<HTMLSelectElement>(null);
  // Refusé (plus assez de places) : la liste revient au nombre enregistré.
  useEffect(() => {
    if (state.error && select.current) select.current.value = String(guests);
  }, [state, guests]);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3 text-[15px]">
        Je viens avec
        <select
          ref={select}
          name="guests"
          key={guests}
          defaultValue={guests}
          disabled={pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={`${inputClass} w-auto`}
        >
          {COUNTS.map((n) => (
            <option key={n} value={n}>
              {guestsLabel(n)}
            </option>
          ))}
        </select>
      </label>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </form>
  );
}
