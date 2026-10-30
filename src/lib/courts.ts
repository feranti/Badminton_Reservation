// Réglages du gymnase habituel.
export const DEFAULT_VENUE = "Le Prisme, Bobigny";
export const DEFAULT_START = "20:00";
export const DEFAULT_END = "22:00";

// Prix habituel d'un terrain : 9 € l'heure, tout compris.
export const PRICE_PER_HOUR_CENTS = 900;

// Prix par défaut d'un terrain sur un créneau (heures « HH:MM »), proportionnel à sa durée.
export function defaultCourtPriceCents(start: string, end: string) {
  const minutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const duration = minutes(end) - minutes(start);
  return Number.isFinite(duration) && duration > 0 ? Math.round((PRICE_PER_HOUR_CENTS * duration) / 60) : null;
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
