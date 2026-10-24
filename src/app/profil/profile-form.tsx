"use client";

import { useFormAction } from "@/components/use-form-action";
import { updateDisplayName, type ProfileState } from "./actions";
import { inputClass, labelClass, primaryButton } from "@/components/ui";

export function ProfileForm({ displayName }: { displayName: string }) {
  const { state, pending, onSubmit } = useFormAction<ProfileState>(updateDisplayName, {});
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className={labelClass}>
        Nom affiché aux autres joueurs
        <input name="display_name" required maxLength={40} defaultValue={displayName} className={inputClass} />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}
