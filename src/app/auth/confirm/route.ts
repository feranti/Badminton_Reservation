import { NextResponse, type NextRequest } from "next/server";
import { consumeLoginLink, createSession, sessionCookie } from "@/lib/auth";

// Point d'arrivée du lien de connexion envoyé par e-mail (marche dans n'importe quel navigateur).
export async function GET(request: NextRequest) {
  const userId = await consumeLoginLink(request.nextUrl.searchParams.get("jeton") ?? "");
  const origin = publicOrigin(request);
  if (!userId) return NextResponse.redirect(new URL("/login?error=lien", origin));
  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.set(sessionCookie(await createSession(userId), new URL(origin).host));
  return response;
}

// Adresse publique du site, telle que le navigateur la voit (derrière Vercel, Traefik ou en local).
function publicOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : request.nextUrl.origin;
}
