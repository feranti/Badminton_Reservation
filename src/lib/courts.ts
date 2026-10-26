// Réglages du gymnase habituel.
export const DEFAULT_VENUE = "Le Prisme, Bobigny";
export const DEFAULT_START = "20:00";
export const DEFAULT_END = "22:00";

// Terrains du gymnase : numérotés de 6 à 14.
export const COURTS = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

// Jours habituels, proposés en raccourci pour une nouvelle réservation (0 = dimanche) : lundi et jeudi.
export const USUAL_WEEKDAYS = [1, 4];

// Invités extérieurs (sans compte) qu'un joueur peut amener à une session : +1 à +7.
export const MAX_GUESTS = 7;
