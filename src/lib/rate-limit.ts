import "server-only";
import { headers } from "next/headers";

// Limite par adresse IP pour la page de connexion, en mémoire : le site tourne dans un seul
// conteneur, et un redémarrage qui remet les compteurs à zéro ne gêne pas. Les limites par joueur
// et la limite totale des e-mails de connexion sont en base (src/lib/auth.ts).

const store = globalThis as unknown as { badmintonRateLimit?: Map<string, number[]> };
const hits = (store.badmintonRateLimit ??= new Map<string, number[]>());

// Adresse IP du visiteur. Traefik (VPS) et Vercel écrasent X-Real-IP et X-Forwarded-For envoyés
// par le visiteur ; sans proxy (copie locale), Next.js les remplit avec l'adresse de la connexion.
export async function clientIp() {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim() || "inconnue";
}

// Compte une tentative et renvoie false si la limite (max par fenêtre de windowMs) est atteinte.
export function allowAttempt(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  const allowed = recent.length < max;
  if (allowed) recent.push(now);
  hits.set(key, recent);
  // Ménage de temps en temps, pour que la mémoire ne grossisse pas avec des adresses oubliées.
  if (hits.size > 5000) {
    for (const [k, list] of hits) if (!list.some((t) => t > now - windowMs)) hits.delete(k);
  }
  return allowed;
}
