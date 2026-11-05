// Réglages du gymnase habituel.
export const DEFAULT_VENUE = "Le Prisme, Bobigny";
export const DEFAULT_START = "20:00";
export const DEFAULT_END = "22:00";

// Prix proposé pour un montant libre (autre gymnase) : 9 € l'heure.
export const PRICE_PER_HOUR_CENTS = 900;

// Durée en minutes d'un créneau (heures « HH:MM »), ou null s'il est vide ou à l'envers.
export function slotMinutes(start: string, end: string) {
  const minutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const duration = minutes(end) - minutes(start);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

// Prix par défaut d'un terrain sur un créneau (heures « HH:MM »), proportionnel à sa durée.
export function defaultCourtPriceCents(start: string, end: string) {
  const duration = slotMinutes(start, end);
  return duration === null ? null : Math.round((PRICE_PER_HOUR_CENTS * duration) / 60);
}

// Tarif « carte 10 sessions » du Prisme : chaque réservant paie 4,50 € l'heure avec la carte,
// 5 € sans. Un terrain doit avoir deux réservants : seul, le capitaine paie en plus 5 € l'heure
// pour le partenaire absent. Même calcul dans la vue balances (0005_tarif_carte.sql).
export const CARD_HOUR_CENTS = 450;
export const NO_CARD_HOUR_CENTS = 500;

export function isCardVenue(venue: string) {
  return /prisme/i.test(venue);
}

// Part d'un réservant pour la durée du créneau.
export function cardShareCents(card: boolean, minutes: number) {
  return Math.round(((card ? CARD_HOUR_CENTS : NO_CARD_HOUR_CENTS) * minutes) / 60);
}

export type CardPricing = { captainCard: boolean; partner: boolean; partnerCard: boolean };

// Détail du prix d'un terrain au tarif carte : part du capitaine, part du partenaire (ou
// supplément s'il n'y en a pas) et total.
export function cardPrice({ captainCard, partner, partnerCard }: CardPricing, minutes: number) {
  const captain = cardShareCents(captainCard, minutes);
  const second = cardShareCents(partner && partnerCard, minutes);
  return { captain, second, total: captain + second };
}

// Terrains du gymnase : numérotés de 6 à 14.
export const COURTS = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

// Jours habituels, proposés en raccourci pour une nouvelle réservation (0 = dimanche) : lundi et jeudi.
export const USUAL_WEEKDAYS = [1, 4];

// Invités extérieurs (sans compte) qu'un joueur peut amener à une session : +1 à +7.
export const MAX_GUESTS = 7;

// Joueurs par terrain (double).
export const PLAYERS_PER_COURT = 4;

// Capacité d'une session : 4 joueurs × le plus grand nombre de terrains réservés en même temps.
// Un terrain de 20:00 à 22:00 et deux autres l'un de 20:00 à 21:00, l'autre de 21:00 à 22:00
// font 2 terrains à la fois, donc 8 places (et non 12). Même calcul que la vue session_players.
export function sessionCapacity(bookings: { court: number; starts_at: string; ends_at: string }[]) {
  let max = 0;
  for (const b of bookings) {
    const at = new Date(b.starts_at).getTime();
    const courts = new Set(
      bookings
        .filter((o) => new Date(o.starts_at).getTime() <= at && new Date(o.ends_at).getTime() > at)
        .map((o) => o.court),
    );
    max = Math.max(max, courts.size);
  }
  return PLAYERS_PER_COURT * max;
}

// Site de l'UCPA pour réserver les terrains du Prisme et acheter la carte 10 sessions.
export const UCPA_LINKS = [
  { label: "Réserver un terrain", href: "https://www.ucpa.com/groupesos/le-prisme/badminton" },
  { label: "Carte 10 sessions", href: "https://www.ucpa.com/groupesos/le-prisme/offre/carte-10-sessions-de-badminton" },
] as const;

// Heures d'une réservation : l'UCPA donne un QR code par heure de terrain.
// Un terrain de 20:00 à 22:00 donne [20:00 – 21:00, 21:00 – 22:00] ; une heure entamée compte.
const HOUR_MS = 60 * 60 * 1000;
export function bookingHours(b: { starts_at: string; ends_at: string }) {
  const start = new Date(b.starts_at).getTime();
  const end = new Date(b.ends_at).getTime();
  const count = Math.min(24, Math.max(1, Math.ceil((end - start) / HOUR_MS)));
  return Array.from({ length: count }, (_, hour) => ({
    hour,
    startsAt: new Date(start + hour * HOUR_MS).toISOString(),
    endsAt: new Date(Math.min(end, start + (hour + 1) * HOUR_MS)).toISOString(),
  }));
}
