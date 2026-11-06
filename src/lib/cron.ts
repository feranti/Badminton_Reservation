// Tâches planifiées (routes /api/cron/…), appelées par GitHub Actions avec l'en-tête
// « Authorization: Bearer <CRON_SECRET> ». Sans CRON_SECRET configuré, tout appel est refusé.
export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
