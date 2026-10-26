import Link from "next/link";
import type { CourtBooking, Session } from "@/lib/data";
import { formatDay, formatTimes } from "@/lib/format";
import { CheckIcon } from "./icons";
import { card } from "./ui";

// Réservations regroupées par terrain : « Terrain 7 · 20:00 – 21:00, 21:00 – 22:00 ».
export function groupByCourt(bookings: CourtBooking[]) {
  const map = new Map<number, CourtBooking[]>();
  for (const b of bookings) map.set(b.court, [...(map.get(b.court) ?? []), b]);
  return [...map.entries()].sort(([a], [b]) => a - b);
}

// Où en est le joueur pour une session : inscrit, en attente (avec son rang), ou pas inscrit.
export function sessionStatus(s: Session, userId: string) {
  const playing = s.players.filter((p) => p.is_playing).length;
  const me = s.players.find((p) => p.player_id === userId);
  return {
    playing,
    free: Math.max(s.capacity - playing, 0),
    me: me ? (me.is_playing ? ("playing" as const) : ("waiting" as const)) : null,
    rank: me && !me.is_playing ? me.position - s.capacity : 0,
  };
}

function StatusBadge({ status }: { status: ReturnType<typeof sessionStatus> }) {
  if (status.me === "playing")
    return <span className="rounded-full bg-accent-tint px-2.5 py-1 text-[13px] font-medium text-accent-ink">Inscrit</span>;
  if (status.me === "waiting")
    return (
      <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[13px] font-medium text-warn-ink">
        Attente n°{status.rank}
      </span>
    );
  return null;
}

// Grande carte de la prochaine session.
export function NextSessionCard({ session: s, userId }: { session: Session; userId: string }) {
  const status = sessionStatus(s, userId);
  const courts = groupByCourt(s.bookings).map(([c]) => c);
  return (
    <Link href={`/sessions/${s.id}`} className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xl font-semibold tracking-tight">{formatDay(s.starts_at, true)}</span>
          <span className="text-[15px] text-muted">
            {formatTimes(s.starts_at, s.ends_at)} · {s.venue}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-sm text-muted">
          <span>
            {status.playing} joueur{status.playing > 1 ? "s" : ""} sur {s.capacity}
          </span>
          <span>
            Terrain{courts.length > 1 ? "s" : ""} {courts.join(" · ")}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (status.playing / s.capacity) * 100)}%` }} />
        </div>
      </div>
    </Link>
  );
}

// Ligne d'une session dans la liste.
export function SessionRow({ session: s, userId, past }: { session: Session; userId: string; past: boolean }) {
  const status = sessionStatus(s, userId);
  let right: React.ReactNode;
  if (status.me === "playing")
    right = (
      <span className="flex items-center gap-1.5 font-medium text-accent-ink">
        <CheckIcon />
        {past ? "Joué" : "Inscrit"}
      </span>
    );
  else if (status.me === "waiting") right = <span className="font-medium text-warn">Attente n°{status.rank}</span>;
  else if (past) right = <span className="text-muted">{status.playing} joueurs</span>;
  else if (status.free > 0)
    right = (
      <span className="font-medium text-accent">
        {status.free} place{status.free > 1 ? "s" : ""}
      </span>
    );
  else right = <span className="text-muted">Complet</span>;

  return (
    <li>
      <Link href={`/sessions/${s.id}`} className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{formatDay(s.starts_at, true)}</span>
          <span className="text-sm text-muted">
            {formatTimes(s.starts_at, s.ends_at)} · {s.venue}
          </span>
        </span>
        <span className="shrink-0 text-sm">{right}</span>
      </Link>
    </li>
  );
}
