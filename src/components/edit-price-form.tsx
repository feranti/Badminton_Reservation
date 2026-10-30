"use client";

import { updateBookingPrice, type FormState } from "@/app/sessions/actions";
import { formatPriceInput } from "@/lib/format";
import { errorText, inputClass, secondaryButton, textButton } from "./ui";
import { useFormAction } from "./use-form-action";

// Prix d'un terrain déjà réservé, à corriger après coup. Les comptes suivent tout seuls. Une fois enregistré, le formulaire se referme (il est remonté avec le nouveau prix).
export function EditPriceForm({ bookingId, priceCents, label }: { bookingId: string; priceCents: number; label: string }) {
  const { state, pending, onSubmit } = useFormAction<FormState>(updateBookingPrice.bind(null, bookingId), {});

  return (
    <details className="group">
      <summary className={`${textButton} cursor-pointer`}>Modifier le prix</summary>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 pt-1">
        <div className="flex gap-2">
          <input
            name="price"
            required
            inputMode="decimal"
            defaultValue={formatPriceInput(priceCents)}
            aria-label={`Prix du ${label}`}
            className={inputClass}
          />
          <button type="submit" disabled={pending} className={secondaryButton}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
        {state.error && (
          <p role="alert" className={errorText}>
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
