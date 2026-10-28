"use client";

import { useEffect, useRef } from "react";
import { declarePayment, type PaymentState } from "@/app/comptes/actions";
import type { Player } from "@/lib/data";
import { errorText, inputClass, labelClass, primaryButton } from "./ui";
import { useFormAction } from "./use-form-action";

export function PaymentForm({ players, userId }: { players: Player[]; userId: string }) {
  const { state, pending, onSubmit } = useFormAction<PaymentState>(declarePayment, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.done) formRef.current?.reset();
  }, [state]);

  const options = players.map((p) => (
    <option key={p.id} value={p.id}>
      {p.id === userId ? "Moi" : p.display_name}
    </option>
  ));

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Payé par
          <select name="from_player" defaultValue={userId} className={inputClass}>
            {options}
          </select>
        </label>
        <label className={labelClass}>
          Reçu par
          <select name="to_player" defaultValue="" required className={inputClass}>
            <option value="" disabled>
              Choisir…
            </option>
            {options}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Montant (€)
          <input name="amount" required inputMode="decimal" placeholder="12,50" className={inputClass} />
        </label>
        <label className={labelClass}>
          Remarque
          <input name="note" maxLength={200} placeholder="Lydia, espèces…" className={inputClass} />
        </label>
      </div>
      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Enregistrement…" : "Signaler le remboursement"}
      </button>
    </form>
  );
}
