"use client";

import { useState } from "react";
import { createBookings, type FormState } from "@/app/sessions/actions";
import { COURTS, DEFAULT_END, DEFAULT_START } from "@/lib/courts";
import type { Player } from "@/lib/data";
import { formatEuros, parseEurosToCents } from "@/lib/format";
import { StickyFooter } from "./app-shell";
import { CalendarIcon } from "./icons";
import { PayerFields } from "./payer-fields";
import { errorText, inputClass, labelClass, primaryButton, textButton } from "./ui";
import { useFormAction } from "./use-form-action";

const chip = (on: boolean) =>
  `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border ${
    on ? "border-accent bg-accent text-on-accent" : "border-edge bg-surface text-ink"
  }`;

export function NewBookingForm({
  players,
  userId,
  dates,
  defaultVenue,
  defaultPrice,
}: {
  players: Player[];
  userId: string;
  dates: { value: string; weekday: string; day: number }[];
  defaultVenue: string;
  defaultPrice: string;
}) {
  const { state, pending, onSubmit } = useFormAction<FormState>(createBookings, {});
  const [date, setDate] = useState(dates[0]?.value ?? "");
  const [otherDate, setOtherDate] = useState(false);
  const [editSlot, setEditSlot] = useState(false);
  const [slot, setSlot] = useState({ start: DEFAULT_START, end: DEFAULT_END, venue: defaultVenue });
  const [courts, setCourts] = useState<number[]>([]);
  const [price, setPrice] = useState(defaultPrice);
  const priceCents = parseEurosToCents(price);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="flex min-w-0 flex-col gap-2.5">
        <legend className="mb-2.5 text-sm font-medium text-muted">Quand</legend>
        <div className="flex gap-2">
          {dates.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={!otherDate && date === d.value}
              onClick={() => {
                setOtherDate(false);
                setDate(d.value);
              }}
              className={chip(!otherDate && date === d.value)}
            >
              <span className="text-xs">{d.weekday}</span>
              <span className="font-semibold">{d.day}</span>
            </button>
          ))}
          <button type="button" aria-pressed={otherDate} aria-label="Autre date" onClick={() => setOtherDate(true)} className={`${chip(otherDate)} max-w-16`}>
            <CalendarIcon className="size-5" />
          </button>
        </div>
        {otherDate ? (
          <input type="date" name="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} aria-label="Date" />
        ) : (
          <input type="hidden" name="date" value={date} />
        )}

        <div className={editSlot ? "hidden" : "flex min-h-12 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3.5"}>
          <span className="min-w-0 truncate">
            {slot.start} – {slot.end} · <span className="text-muted">{slot.venue}</span>
          </span>
          <button type="button" onClick={() => setEditSlot(true)} className={textButton}>
            Modifier
          </button>
        </div>
        <div className={editSlot ? "flex flex-col gap-3" : "hidden"}>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Début
              <input type="time" name="start" required value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Fin
              <input type="time" name="end" required value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} className={inputClass} />
            </label>
          </div>
          <label className={labelClass}>
            Gymnase
            <input name="venue" required value={slot.venue} onChange={(e) => setSlot({ ...slot, venue: e.target.value })} className={inputClass} />
          </label>
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-2.5 text-sm font-medium text-muted">Terrains réservés</legend>
        <div className="grid grid-cols-5 gap-2">
          {COURTS.map((court) => (
            <label key={court} className="cursor-pointer">
              <input
                type="checkbox"
                name="courts"
                value={court}
                checked={courts.includes(court)}
                onChange={(e) => setCourts(e.target.checked ? [...courts, court] : courts.filter((c) => c !== court))}
                className="peer sr-only"
              />
              <span className="flex h-12 items-center justify-center rounded-xl border border-edge bg-surface font-medium peer-checked:border-accent peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-on-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                {court}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <PayerFields players={players} userId={userId}>
        <label className={labelClass}>
          Prix par terrain (€)
          <input
            name="price"
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
            placeholder="12,50"
          />
        </label>
      </PayerFields>

      <label className="flex min-h-13 cursor-pointer items-center justify-between rounded-xl border border-line bg-surface px-3.5">
        Je joue
        <input type="checkbox" name="i_play" defaultChecked className="size-5 accent-accent" />
      </label>

      {state.error && (
        <p role="alert" className={errorText}>
          {state.error}
        </p>
      )}

      <StickyFooter>
        <button type="submit" disabled={pending} className={`${primaryButton} min-h-13 w-full text-base`}>
          {pending
            ? "Enregistrement…"
            : courts.length === 0
              ? "Réserver"
              : `Réserver ${courts.length} terrain${courts.length > 1 ? "s" : ""}${
                  priceCents === null ? "" : ` · ${formatEuros(priceCents * courts.length)}`
                }`}
        </button>
      </StickyFooter>
    </form>
  );
}
