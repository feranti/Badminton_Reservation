import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { movedResponse, newSiteOrigin } from "@/lib/demenagement";

// Les tâches planifiées (/api/cron/…) sont appelées par GitHub Actions, sans compte : chaque route vérifie elle-même le secret (src/lib/cron.ts).
const PUBLIC_PATHS = ["/login", "/auth/", "/api/cron/"];

// Renvoie vers /login un visiteur sans session. La session elle-même est vérifiée en base par
// requirePlayer() (src/lib/session.ts), qui renvoie aussi vers /login si elle n'est plus valable.
// Les anciennes sessions Supabase ne sont plus reprises : un jeton Supabase s'obtient aussi avec le
// mot de passe Supabase du joueur, ce qui contournerait l'e-mail de connexion.
export function proxy(request: NextRequest) {
  // Ancien site : message de déménagement sur toutes les pages (src/lib/demenagement.ts).
  const newSite = newSiteOrigin();
  if (newSite) return movedResponse(request, newSite);

  if (request.cookies.has(SESSION_COOKIE) || isPublic(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

const isPublic = (request: NextRequest) => PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

export const config = {
  // Tout sauf les fichiers statiques et les images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
