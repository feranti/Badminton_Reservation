import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-url";
import { isCronAuthorized } from "@/lib/cron";
import { CANCEL_HOURS, REMINDER_HOURS, emptyCourtReminder, sessionState } from "@/lib/notify";
import { adminDb as admin } from "@/lib/db";
import { sendToGroup } from "@/lib/whatsapp";

// Appelée toutes les 6 heures par GitHub Actions (.github/workflows/rappel-terrains-vides.yml).
// Pour chaque session qui commence dans 48 à 72h et qui n'a pas encore eu de rappel, prévient
// le groupe WhatsApp s'il manque au moins 4 joueurs. Une session assez remplie est revue à chaque
// passage tant qu'on peut encore annuler : si des joueurs se désinscrivent, le rappel part alors.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  const now = Date.now();
  const hours = (h: number) => new Date(now + h * 3600e3).toISOString();
  let due: { id: string }[];
  try {
    due = await admin<{ id: string }>`
      select id from public.sessions
      where cancelled_at is null and reminder_sent_at is null
        and starts_at >= ${hours(CANCEL_HOURS)} and starts_at <= ${hours(REMINDER_HOURS)}`;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  // Adresse publique du site (src/lib/app-url.ts), jamais request.url : dans le conteneur du VPS,
  // c'est l'adresse d'écoute du serveur (https://0.0.0.0:3000).
  const origin = await appOrigin();
  const sent: string[] = [];
  const errors: string[] = [];
  for (const { id } of due) {
    const state = await sessionState(admin, id);
    const message = state && emptyCourtReminder(state, origin ? `${origin}/sessions/${id}` : "");
    if (!message) continue;
    // La session est marquée avant l'envoi, pour qu'un second appel simultané n'envoie rien.
    const claimed = await admin`
      update public.sessions set reminder_sent_at = now()
      where id = ${id} and reminder_sent_at is null
      returning id`;
    if (!claimed.length) continue;
    try {
      await sendToGroup(message);
      sent.push(id);
    } catch (e) {
      // Envoi raté : on retentera au prochain passage.
      await admin`update public.sessions set reminder_sent_at = null where id = ${id}`;
      errors.push(`${id} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return NextResponse.json({ checked: due.length, sent, errors }, { status: errors.length ? 500 : 200 });
}
