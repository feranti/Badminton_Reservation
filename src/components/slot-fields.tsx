import { inputClass, labelClass } from "./ui";

// Date, heure de début et heure de fin d'une soirée (heure de Paris).
export function SlotFields({ date, start, end }: { date: string; start: string; end: string }) {
  return (
    <>
      <label className={labelClass}>
        Date
        <input type="date" name="date" required defaultValue={date} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Début
          <input type="time" name="start" required defaultValue={start} className={inputClass} />
        </label>
        <label className={labelClass}>
          Fin
          <input type="time" name="end" required defaultValue={end} className={inputClass} />
        </label>
      </div>
    </>
  );
}
