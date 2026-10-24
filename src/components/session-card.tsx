import Link from "next/link";
import type { CourtBooking, Player, Session } from "@/lib/data";
import { formatEuros, formatSlot, formatTimes, shareCents } from "@/lib/format";
import { SessionPlayers } from "./session-players";

// Réservations regroupées par terrain : « Terrain 7 · 20:00 – 21:00, 21:00 – 22:00 ».
export function groupByCourt(bookings: CourtBooking[]) {
  const map = new Map<number, CourtBooking[]>();
  for (const b of bookings) map.set(b.court, [...(map.get(b.court) ?? []), b]);
  return [...map.entries()].sort(([a], [b]) => a - b);
}

export function SessionCard({
  session,
  players,
  userId,
  past,
}: {
  session: Session;
  players: Map<string, Player>;
  userId: string;
  past: boolean;
}) {
  const s = session;
  const name = (id: string) => (id === userId ? "vous" : (players.get(id)?.display_name ?? "?"));
  const courts = groupByCourt(s.bookings);
  const playingCount = s.players.filter((p) => p.is_playing).length;
  const sameSlot = s.bookings.every((b) => b.starts_at === s.starts_at && b.ends_at === s.ends_at);

  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{formatSlot(s.starts_at, s.ends_at)}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.venue}</p>
        </div>
        <Link href={`/sessions/${s.id}`} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
          Détails
        </Link>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {courts.map(([court, list]) => (
          <li key={court} className="rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-700">
            <strong>Terrain {court}</strong>
            {!sameSlot && <> · {list.map((b) => formatTimes(b.starts_at, b.ends_at)).join(", ")}</>} ·{" "}
            {[...new Set(list.flatMap((b) => [b.booked_by, b.co_payer]).filter((id): id is string => Boolean(id)))]
              .map(name)
              .join(" et ")}
            {list.every((b) => b.qr_path) && <span title="QR code disponible"> · QR ✓</span>}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-sm">
        {courts.length} terrain{courts.length > 1 ? "s" : ""} · {formatEuros(s.totalCents)}
        {playingCount > 0 && <> · {formatEuros(shareCents(s.totalCents, playingCount))} par joueur</>}
      </p>
      {s.notes && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.notes}</p>}

      <div className="mt-3">
        <SessionPlayers session={s} players={players} userId={userId} canJoin={!past} />
      </div>
    </li>
  );
}
