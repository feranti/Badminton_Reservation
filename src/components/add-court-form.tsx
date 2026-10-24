"use client";

import { useActionState } from "react";
import { addCourt, type FormState } from "@/app/soirees/actions";
import type { Player } from "@/lib/data";
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
  const [state, action, pending] = useActionState<FormState, FormData>(addCourt.bind(null, sessionId), {});

  return (
    <form action={action} className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <p className="text-sm font-medium">Ajouter un terrain</p>
      <div className="grid grid-cols-3 gap-2">
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
        <select name="booked_by" aria-label="Payé par" defaultValue={userId} className={inputClass}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
      </div>
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
