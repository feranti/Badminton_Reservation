"use client";

import { updateSession, type FormState } from "@/app/sessions/actions";
import { inputClass, labelClass, primaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

// Lieu et remarques d'une session. Les horaires découlent de ses réservations.
export function EditSessionForm({ id, venue, notes }: { id: string; venue: string; notes: string }) {
  const { state, pending, onSubmit } = useFormAction<FormState>(updateSession, {});

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <label className={labelClass}>
        Gymnase
        <input name="venue" required defaultValue={venue} className={inputClass} />
      </label>
      <label className={labelClass}>
        Remarques
        <textarea name="notes" rows={2} defaultValue={notes} className={inputClass} placeholder="Volants à apporter…" />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.added && <p className="text-sm text-emerald-700">Enregistré.</p>}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}
