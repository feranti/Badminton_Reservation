import { onDbChange } from "@/lib/db";
import { requirePlayer } from "@/lib/session";

// Tables dont un changement recharge les pages ouvertes (src/components/realtime-refresh.tsx).
const TABLES = new Set(["sessions", "court_bookings", "booking_qr_codes", "session_participants", "payments"]);
// Le flux se ferme après quelques minutes : le navigateur se reconnecte tout seul, et la session
// du joueur est revérifiée à chaque reconnexion.
const DUREE_MAX_MS = 5 * 60_000;

// Flux d'événements (Server-Sent Events) : le nom de la table modifiée, rien d'autre.
export async function GET(request: Request) {
  await requirePlayer();
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const unsubscribe = onDbChange((table) => {
        if (TABLES.has(table)) send(`data: ${table}\n\n`);
      });
      // Commentaire régulier : garde la connexion ouverte à travers les proxys.
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      const end = setTimeout(() => {
        stop();
        try {
          controller.close();
        } catch {}
      }, DUREE_MAX_MS);
      stop = () => {
        unsubscribe();
        clearInterval(ping);
        clearTimeout(end);
      };
      request.signal.addEventListener("abort", () => stop());
      send("retry: 3000\n\n");
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
