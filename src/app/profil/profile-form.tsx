"use client";

import { useFormAction } from "@/components/use-form-action";
import { updateDisplayName, type ProfileState } from "./actions";
import { errorText, inputClass, labelClass, primaryButton } from "@/components/ui";

export function ProfileForm({ displayName }: { displayName: string }) {
  const { state, pending, onSubmit } = useFormAction<ProfileState>(updateDisplayName, {});
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className={labelClass} htmlFor="display_name">
        Nom affiché aux autres
      </label>
      <div className="flex gap-2">
        <input id="display_name" name="display_name" required maxLength={40} defaultValue={displayName} className={inputClass} />
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "…" : "Enregistrer"}
        </button>
      </div>
      {state.done && !pending && <p className="text-sm text-accent-ink">Enregistré.</p>}
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
    </form>
  );
}
