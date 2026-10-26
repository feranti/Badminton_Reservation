"use client";

import { updateSession, type FormState } from "@/app/sessions/actions";
import { errorText, inputClass, labelClass, secondaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

// Lieu et note d'une session. Les horaires découlent de ses réservations.
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
        Note pour les joueurs
        <input name="notes" defaultValue={notes} className={inputClass} placeholder="Volants à apporter…" />
      </label>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButton}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {state.added && !pending && <span className="text-sm text-accent-ink">Enregistré.</span>}
      </div>
    </form>
  );
}
