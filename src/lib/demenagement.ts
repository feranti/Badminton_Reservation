import type { NextRequest } from "next/server";

// Ancien site (Vercel) : quand NOUVEAU_SITE est défini (par exemple https://bad-resas.feranti.dev),
// chaque page affiche un message de déménagement puis renvoie vers la même adresse sur le nouveau
// site. Rien n'est lu en base : l'ancien site n'a plus besoin d'y accéder.

const REDIRECT_SECONDS = 5;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Adresse du nouveau site, ou null si la variable est absente ou invalide (le site marche alors normalement).
export function newSiteOrigin(): URL | null {
  const raw = process.env.NOUVEAU_SITE?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.hostname === "127.0.0.1" ? new URL(url.origin) : null;
  } catch {
    return null;
  }
}

export function movedResponse(request: NextRequest, origin: URL) {
  // Même chemin sur le nouveau site, jamais un autre domaine.
  // (le chemin est posé à part : « //autre.site/x » ne doit pas changer de domaine)
  const target = new URL(origin);
  target.pathname = request.nextUrl.pathname;
  target.search = request.nextUrl.search;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

  // Tâches planifiées, flux temps réel, envois de formulaires : pas de page, une erreur explicite.
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api/")) {
    return new Response(`Le site a déménagé : ${target.href}\n`, {
      status: 410,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const href = escapeHtml(target.href);
  const host = escapeHtml(origin.host);
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${REDIRECT_SECONDS};url=${href}">
<meta name="robots" content="noindex">
<title>Le site a déménagé</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #1b1f24; --muted: #5b6470; --accent: #1f6feb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1216; --card: #181c22; --text: #e8ebef; --muted: #9aa4b0; --accent: #4c8dff; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 440px; background: var(--card); border-radius: 16px; padding: 28px 24px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  h1 { font-size: 1.4rem; margin: 0 0 12px; }
  p { margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: .9rem; }
  a.bouton { display: block; text-align: center; background: var(--accent); color: #fff; text-decoration: none;
             font-weight: 600; padding: 12px 16px; border-radius: 10px; margin: 20px 0 16px; }
</style>
</head>
<body>
<main>
  <h1>Le site a déménagé</h1>
  <p>Les réservations de badminton sont maintenant sur <strong>${host}</strong>.</p>
  <p>Cette ancienne adresse fermera bientôt : pensez à mettre à jour vos favoris.</p>
  <p>Si vous avez installé l'appli sur votre téléphone, supprimez-la, puis réinstallez-la depuis la nouvelle adresse.</p>
  <a class="bouton" href="${href}">Aller sur le nouveau site</a>
  <p class="muted">Vous y serez redirigé automatiquement dans quelques secondes. Si on vous demande de vous reconnecter, entrez votre adresse e-mail comme d'habitude.</p>
</main>
</body>
</html>
`;
  return new Response(html, { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
