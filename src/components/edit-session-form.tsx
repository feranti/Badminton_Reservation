"use client";

import { useFormAction } from "@/components/use-form-action";
import { updateSession, type FormState } from "@/app/soirees/actions";
import { SlotFields } from "./slot-fields";
import { inputClass, labelClass, primaryButton } from "./ui";

export function EditSessionForm({
  id,
  venue,
  date,
  start,
  end,
  notes,
}: {
  id: string;
  venue: string;
  date: string;
  start: string;
  end: string;
  notes: string;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(updateSession, {});

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <label className={labelClass}>
        Gymnase
        <input name="venue" required defaultValue={venue} className={inputClass} />
      </label>
      <SlotFields date={date} start={start} end={end} />
      <label className={labelClass}>
        Remarques
        <textarea name="notes" rows={2} defaultValue={notes} className={inputClass} />
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
