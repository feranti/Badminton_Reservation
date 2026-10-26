"use client";

import { updateSession, type FormState } from "@/app/sessions/actions";
import { errorText, inputClass, labelClass, secondaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

export const editSessionFormId = "edit-session";

// Lieu et note d'une session. Les horaires découlent de ses réservations.
// Le bouton OK de l'en-tête (SessionDoneButton) envoie aussi ce formulaire, puis revient à la session.
export function EditSessionForm({ id, venue, notes }: { id: string; venue: string; notes: string }) {
  const { state, pending, onSubmit } = useFormAction<FormState>(updateSession, {});

  return (
    <form id={editSessionFormId} onSubmit={onSubmit} className="flex flex-col gap-4">
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

export function SessionDoneButton() {
  return (
    <button
      type="submit"
      form={editSessionFormId}
      name="done"
      value="1"
      className="flex min-h-11 items-center px-3 text-[15px] font-semibold text-accent"
    >
      OK
    </button>
  );
}
