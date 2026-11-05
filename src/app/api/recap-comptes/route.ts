import { NextResponse, type NextRequest } from "next/server";
import { buildRecap, isRecapTime } from "@/lib/recap";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToGroup } from "@/lib/whatsapp";

// Récap hebdomadaire des comptes dans le groupe WhatsApp, appelé par la tâche planifiée de
// Vercel (vercel.json). Vercel envoie CRON_SECRET dans l'en-tête Authorization.
// ?force=1 envoie le récap tout de suite, quel que soit le jour (test, envoi à la main).
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("force") !== "1" && !isRecapTime()) {
    return NextResponse.json({ sent: false, reason: "pas lundi 23 h à Paris" });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SECRET_KEY absente" }, { status: 500 });

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const link = `${host ? `https://${host}` : request.nextUrl.origin}/comptes`;
  const message = await buildRecap(admin, link);
  await sendToGroup(message);
  return NextResponse.json({ sent: true });
}
