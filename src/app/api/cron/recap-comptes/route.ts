import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { buildRecap } from "@/lib/recap";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToGroup } from "@/lib/whatsapp";

// Récap hebdomadaire des comptes dans le groupe WhatsApp. Envoyé à chaque appel : c'est le
// workflow GitHub Actions (.github/workflows/recap-comptes.yml) qui choisit le lundi à 23 h.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SECRET_KEY absente" }, { status: 500 });

  // Adresse publique du site (APP_URL) : derrière le proxy du VPS, l'adresse de la requête peut
  // être celle du conteneur.
  const origin = process.env.APP_URL?.replace(/\/$/, "") || request.nextUrl.origin;
  const link = `${origin}/comptes`;
  await sendToGroup(await buildRecap(admin, link));
  return NextResponse.json({ sent: true });
}
