"use client";

import { useState } from "react";
import type { Player } from "@/lib/data";
import { inputClass, labelClass, textButton } from "./ui";

// Payeur (par défaut : soi-même) et, sur demande, un second payeur qui paie la moitié.
export function PayerFields({ players, userId, children }: { players: Player[]; userId: string; children?: React.ReactNode }) {
  const [shared, setShared] = useState(false);
  const options = players.map((p) => (
    <option key={p.id} value={p.id}>
      {p.id === userId ? "Moi" : p.display_name}
    </option>
  ));
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        {children}
        <label className={labelClass}>
          Payé par
          <select name="booked_by" defaultValue={userId} className={inputClass}>
            {options}
          </select>
        </label>
      </div>
      {shared ? (
        <label className={labelClass}>
          Partagé avec (moitié chacun)
          <select name="co_payer" defaultValue="" className={inputClass}>
            <option value="">Personne</option>
            {options}
          </select>
        </label>
      ) : (
        <button type="button" onClick={() => setShared(true)} className={`${textButton} self-start`}>
          + Partager le paiement
        </button>
      )}
    </div>
  );
}
