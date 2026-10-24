import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatSlot } from "@/lib/format";
import { sendMail } from "@/lib/mail";
import { createAdminClient } from "@/lib/supabase/admin";

type Client = SupabaseClient<Database>;

export type Snapshot = { registered: Set<string>; playing: Set<string> };

// Inscrits et joueurs effectifs (hors liste d'attente) d'une session, à un instant donné.
export async function snapshot(supabase: Client, sessionId: string): Promise<Snapshot> {
  const { data } = await supabase.from("session_players").select("player_id, is_playing").eq("session_id", sessionId);
  return {
    registered: new Set((data ?? []).map((p) => p.player_id)),
    playing: new Set((data ?? []).filter((p) => p.is_playing).map((p) => p.player_id)),
  };
}

// Prévient par e-mail les joueurs qui viennent de passer de la liste d'attente aux joueurs effectifs.
// N'interrompt jamais l'action en cours : une erreur d'envoi est seulement journalisée.
export async function notifyPromotions(supabase: Client, sessionId: string, before: Snapshot, actorId: string) {
  try {
    const after = await snapshot(supabase, sessionId);
    // Promus = étaient inscrits mais en liste d'attente, et jouent maintenant.
    const waiting = [...after.playing]
      .filter((id) => before.registered.has(id) && !before.playing.has(id) && id !== actorId)
      .map((player_id) => ({ player_id }));
    if (waiting.length === 0) return;
    const { data: session } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
    if (!session) return;

    const admin = createAdminClient();
    if (!admin) {
      console.info(`[liste d'attente] ${waiting.length} joueur(s) promu(s), clé SUPABASE_SECRET_KEY absente : pas d'e-mail.`);
      return;
    }
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const link = host ? `${proto}://${host}/sessions/${sessionId}` : "";
    const slot = formatSlot(session.starts_at, session.ends_at);

    for (const { player_id } of waiting) {
      const { data } = await admin.auth.admin.getUserById(player_id);
      const email = data.user?.email;
      if (!email) continue;
      await sendMail({
        to: email,
        subject: `Une place s'est libérée : vous jouez ${slot.toLowerCase()}`,
        text:
          `Bonne nouvelle ! Une place s'est libérée et vous passez de la liste d'attente aux joueurs de la session :\n\n` +
          `${slot}\n${session.venue}\n\n` +
          (link ? `Voir la session : ${link}\n\n` : "") +
          `Si vous ne pouvez plus venir, désinscrivez-vous pour laisser la place au suivant.\n`,
      });
    }
  } catch (error) {
    console.error("[liste d'attente] notification impossible", error);
  }
}
