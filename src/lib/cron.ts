import { createHash, timingSafeEqual } from "node:crypto";

// Tâches planifiées (routes /api/cron/…), appelées par GitHub Actions avec l'en-tête
// « Authorization: Bearer <CRON_SECRET> ». Sans CRON_SECRET configuré, tout appel est refusé.
// Ces routes lisent la base sans règles d'accès : comparaison en temps constant.
export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}
