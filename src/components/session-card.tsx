import Link from "next/link";
import { addParticipant, removeParticipant } from "@/app/soirees/actions";
import type { Player, Session } from "@/lib/data";
import { formatEuros, formatSlot, shareCents } from "@/lib/format";
import { primaryButton, secondaryButton } from "./ui";

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
  const iPlay = s.participantIds.includes(userId);
  const count = s.participantIds.length;

  return (
    <li className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{formatSlot(s.starts_at, s.ends_at)}</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.venue}</p>
        </div>
        <Link href={`/soirees/${s.id}`} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
          Détails
        </Link>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {s.courts.map((c) => (
          <li key={c.id} className="rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-700">
            <strong>Terrain {c.court}</strong> · {name(c.booked_by)}
            {c.co_payer && <> et {name(c.co_payer)}</>}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-sm">
        {s.courts.length} terrain{s.courts.length > 1 ? "s" : ""} · {formatEuros(s.totalCents)}
        {count > 0 && <> · {formatEuros(shareCents(s.totalCents, count))} par joueur</>}
      </p>
      {s.notes && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.notes}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">{count} joueur{count > 1 ? "s" : ""} :</span>
        {s.participantIds.map((id) => (
          <span
            key={id}
            className={`rounded-full px-2.5 py-0.5 text-sm ${
              id === userId
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                : "bg-zinc-100 dark:bg-zinc-800"
            }`}
          >
            {players.get(id)?.display_name ?? "?"}
          </span>
        ))}
      </div>

      {!past && (
        <form
          action={iPlay ? removeParticipant.bind(null, s.id, userId) : addParticipant.bind(null, s.id, userId)}
          className="mt-3"
        >
          <button type="submit" className={iPlay ? secondaryButton : primaryButton}>
            {iPlay ? "Je ne joue plus" : "Je joue"}
          </button>
        </form>
      )}
    </li>
  );
}
