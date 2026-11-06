import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { CANCEL_HOURS, REMINDER_HOURS, emptyCourtReminder, sessionState } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendToGroup } from "@/lib/whatsapp";

// Appelée toutes les heures par GitHub Actions (.github/workflows/rappel-terrains-vides.yml).
// Pour chaque session qui commence dans 48 à 72h et qui n'a pas encore eu de rappel, prévient
// le groupe WhatsApp s'il manque au moins 4 joueurs. Une session assez remplie est revue à chaque
// passage tant qu'on peut encore annuler : si des joueurs se désinscrivent, le rappel part alors.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SECRET_KEY absente" }, { status: 500 });

  const now = Date.now();
  const hours = (h: number) => new Date(now + h * 3600e3).toISOString();
  const { data: due, error } = await admin
    .from("sessions")
    .select("id")
    .is("reminder_sent_at", null)
    .gte("starts_at", hours(CANCEL_HOURS))
    .lte("starts_at", hours(REMINDER_HOURS));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const sent: string[] = [];
  const errors: string[] = [];
  for (const { id } of due ?? []) {
    const state = await sessionState(admin, id);
    const message = state && emptyCourtReminder(state, `${origin}/sessions/${id}`);
    if (!message) continue;
    // La session est marquée avant l'envoi, pour qu'un second appel simultané n'envoie rien.
    const { data: claimed } = await admin
      .from("sessions")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", id)
      .is("reminder_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    try {
      await sendToGroup(message);
      sent.push(id);
    } catch (e) {
      // Envoi raté : on retentera au prochain passage.
      await admin.from("sessions").update({ reminder_sent_at: null }).eq("id", id);
      errors.push(`${id} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return NextResponse.json({ checked: due?.length ?? 0, sent, errors }, { status: errors.length ? 500 : 200 });
}
