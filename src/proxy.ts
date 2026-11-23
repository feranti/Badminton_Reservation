import { NextResponse, type NextRequest } from "next/server";
import { createSession, SESSION_COOKIE, sessionCookie } from "@/lib/auth";
import { supabaseCookies, supabaseUserId } from "@/lib/supabase/proxy";

// Les tâches planifiées (/api/cron/…) sont appelées par GitHub Actions, sans compte : chaque route vérifie elle-même le secret (src/lib/cron.ts).
const PUBLIC_PATHS = ["/login", "/auth", "/api/cron/"];

// Renvoie vers /login un visiteur sans session. La session elle-même est vérifiée en base par
// requirePlayer() (src/lib/session.ts), qui renvoie aussi vers /login si elle n'est plus valable.
export async function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // Ancienne session Supabase : on la remplace par une session du site, puis on recharge la page.
  const oldCookies = supabaseCookies(request);
  if (oldCookies.length > 0) {
    const userId = await supabaseUserId(request);
    const response =
      userId && request.method === "GET" ? NextResponse.redirect(request.nextUrl) : NextResponse.next();
    if (userId) {
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      response.cookies.set(sessionCookie(await createSession(userId), host));
    }
    for (const c of oldCookies) response.cookies.delete(c.name);
    if (userId || isPublic(request)) return response;
  }

  if (isPublic(request)) return NextResponse.next();
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
