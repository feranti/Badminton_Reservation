import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { consumeLoginLink, createSession, sessionCookie } from "@/lib/auth";

// Point d'arrivée du lien de connexion envoyé par e-mail (marche dans n'importe quel navigateur).
export async function GET(request: NextRequest) {
  const userId = await consumeLoginLink(request.nextUrl.searchParams.get("jeton") ?? "");
  // Adresse publique du site (APP_URL), jamais lue dans X-Forwarded-Host (src/lib/app-url.ts).
  const origin = (await appOrigin()) ?? request.nextUrl.origin;
  if (!userId) return NextResponse.redirect(new URL("/login?error=lien", origin));
  const response = NextResponse.redirect(new URL("/", origin));
  response.cookies.set(sessionCookie(await createSession(userId), new URL(origin).host));
  return response;
}
