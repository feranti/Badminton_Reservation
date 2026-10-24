// Fuseau horaire du club : toutes les heures sont affichées et saisies dans ce fuseau.
export const APP_TIMEZONE = "Europe/Paris";

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function formatEuros(cents: number) {
  return euros.format(cents / 100);
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: APP_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  timeZone: APP_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
});

// « samedi 25 octobre, 19:00 – 20:00 »
export function formatSlot(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const day = dayFormat.format(start);
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${timeFormat.format(start)} – ${timeFormat.format(new Date(endsAt))}`;
}

// Valeurs pour pré-remplir les champs <input type="date"> et <input type="time">.
export function toDateAndTime(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// « 12,50 » ou « 12.5 » → 1250. Renvoie null si la saisie n'est pas un montant valide.
export function parseEurosToCents(input: string): number | null {
  const normalized = input.replace(/\s|€/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

// Part de chacun, arrondie au centime.
export function shareCents(priceCents: number, participants: number) {
  return participants > 0 ? Math.round(priceCents / participants) : priceCents;
}

// 1250 → « 12,50 », pour pré-remplir un champ de prix.
export function formatPriceInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

// Décalage (en ms) entre l'heure de Paris et UTC à un instant donné.
function parisOffsetMs(utcMs: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

// « 2026-10-25 » + « 19:00 » (heure de Paris) → ISO en UTC. Renvoie null si la saisie est invalide.
export function parisToIso(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  let ms = asUtc - parisOffsetMs(asUtc);
  ms = asUtc - parisOffsetMs(ms); // second passage pour les jours de changement d'heure
  return new Date(ms).toISOString();
}
