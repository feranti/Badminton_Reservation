// Tâches planifiées (GitHub Actions, voir .github/workflows/) : elles appellent les routes
// /api/cron/… avec l'en-tête « Authorization: Bearer <CRON_SECRET> ». Sans CRON_SECRET, tout est refusé.
export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
