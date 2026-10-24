import type { Player } from "@/lib/data";
import { inputClass, labelClass } from "./ui";

// Payeur principal et second payeur optionnel d'un terrain.
export function PayerFields({ players, userId }: { players: Player[]; userId: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={labelClass}>
        Payé par
        <select name="booked_by" defaultValue={userId} className={inputClass}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Second payeur
        <select name="co_payer" defaultValue="" className={inputClass}>
          <option value="">Aucun</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
