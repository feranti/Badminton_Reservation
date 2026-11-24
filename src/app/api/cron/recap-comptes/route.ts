import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { isCronAuthorized } from "@/lib/cron";
import { buildRecap } from "@/lib/recap";
import { adminDb } from "@/lib/db";
import { sendToGroup } from "@/lib/whatsapp";

// Récap hebdomadaire des comptes dans le groupe WhatsApp. Envoyé à chaque appel : c'est le
// workflow GitHub Actions (.github/workflows/recap-comptes.yml) qui choisit le lundi à 23 h.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  // Adresse publique du site (src/lib/app-url.ts). Jamais request.nextUrl : dans le conteneur du
  // VPS, c'est l'adresse d'écoute du serveur (https://0.0.0.0:3000), pas celle du site.
  const origin = await appOrigin();
  const link = origin ? `${origin}/comptes` : "";
  await sendToGroup(await buildRecap(adminDb, link));
  return NextResponse.json({ sent: true });
}
