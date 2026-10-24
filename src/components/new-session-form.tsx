"use client";

import { useFormAction } from "@/components/use-form-action";
import { createSession, type FormState } from "@/app/soirees/actions";
import { COURTS, DEFAULT_END, DEFAULT_START } from "@/lib/courts";
import type { Player } from "@/lib/data";
import { PayerFields } from "./payer-fields";
import { SlotFields } from "./slot-fields";
import { inputClass, labelClass, primaryButton } from "./ui";

export function NewSessionForm({
  players,
  userId,
  defaultVenue,
  defaultPrice,
}: {
  players: Player[];
  userId: string;
  defaultVenue: string;
  defaultPrice: string;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(createSession, {});

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className={labelClass}>
        Gymnase
        <input name="venue" required defaultValue={defaultVenue} className={inputClass} placeholder="Le Prisme, Bobigny" />
      </label>
      <SlotFields date="" start={DEFAULT_START} end={DEFAULT_END} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Terrains réservés</legend>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
          {COURTS.map((court) => (
            <label key={court} className="cursor-pointer">
              <input type="checkbox" name="courts" value={court} className="peer sr-only" />
              <span className="flex h-11 items-center justify-center rounded-lg border border-zinc-300 font-medium peer-checked:border-emerald-600 peer-checked:bg-emerald-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 dark:border-zinc-700">
                {court}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className={labelClass}>
        Prix par terrain (€)
        <input name="price" required inputMode="decimal" defaultValue={defaultPrice} className={inputClass} placeholder="12,50" />
      </label>
      <PayerFields players={players} userId={userId} />
      <p className="-mt-2 text-xs text-zinc-500">
        Avec un second payeur, chacun avance la moitié du prix. Si d&apos;autres personnes ont payé d&apos;autres terrains,
        ajoutez-les ensuite depuis la page de la soirée.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="i_play" defaultChecked className="size-4" />
        Je joue à cette soirée
      </label>
      <label className={labelClass}>
        Remarques
        <textarea name="notes" rows={2} className={inputClass} placeholder="Volants à apporter…" />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButton}>
        {pending ? "Enregistrement…" : "Ajouter la soirée"}
      </button>
    </form>
  );
}
