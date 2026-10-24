"use client";

import { useEffect, useRef } from "react";
import { useFormAction } from "./use-form-action";
import { addCourt, type FormState } from "@/app/soirees/actions";
import type { Player } from "@/lib/data";
import { PayerFields } from "./payer-fields";
import { inputClass, secondaryButton } from "./ui";

export function AddCourtForm({
  sessionId,
  freeCourts,
  players,
  userId,
  defaultPrice,
}: {
  sessionId: string;
  freeCourts: number[];
  players: Player[];
  userId: string;
  defaultPrice: string;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(addCourt.bind(null, sessionId), {});
  const formRef = useRef<HTMLFormElement>(null);

  // Après un ajout réussi, on vide le formulaire pour le terrain suivant.
  useEffect(() => {
    if (state.added) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <p className="text-sm font-medium">Ajouter un terrain</p>
      <div className="grid grid-cols-2 gap-2">
        <select name="court" required aria-label="Terrain" className={inputClass} defaultValue="">
          <option value="" disabled>
            N°
          </option>
          {freeCourts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input name="price" required inputMode="decimal" aria-label="Prix (€)" defaultValue={defaultPrice} placeholder="Prix €" className={inputClass} />
      </div>
      <PayerFields players={players} userId={userId} />
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={secondaryButton}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
    </form>
  );
}
