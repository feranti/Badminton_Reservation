import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addParticipantFromForm, deleteSession, removeCourt, removeParticipant } from "@/app/soirees/actions";
import { AddCourtForm } from "@/components/add-court-form";
import { ConfirmButton } from "@/components/confirm-button";
import { AppHeader } from "@/components/app-header";
import { EditSessionForm } from "@/components/edit-session-form";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { dangerButton, inputClass, secondaryButton } from "@/components/ui";
import { COURTS } from "@/lib/courts";
import { getPlayers, getSession } from "@/lib/data";
import { formatEuros, formatPriceInput, formatSlot, shareCents, toDateAndTime } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function SessionPage({ params }: PageProps<"/soirees/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <RealtimeRefresh />
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Toutes les soirées
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Chargement…</p>}>
        <SessionDetails params={params} />
      </Suspense>
    </main>
  );
}

async function SessionDetails({ params }: { params: PageProps<"/soirees/[id]">["params"] }) {
  const { id } = await params;
  const { userId } = await requirePlayer();
  const [session, players] = await Promise.all([getSession(id), getPlayers()]);
  if (!session) notFound();

  const s = session;
  const name = (pid: string) => {
    const n = players.find((p) => p.id === pid)?.display_name ?? "?";
    return pid === userId ? `${n} (vous)` : n;
  };
  const notPlaying = players.filter((p) => !s.participantIds.includes(p.id));
  const freeCourts = COURTS.filter((c) => !s.courts.some((b) => b.court === c));
  const start = toDateAndTime(s.starts_at);
  const end = toDateAndTime(s.ends_at);
  const count = s.participantIds.length;
  const lastPrice = s.courts.at(-1)?.price_cents;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{formatSlot(s.starts_at, s.ends_at)}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{s.venue}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Terrains · {formatEuros(s.totalCents)}
        </h2>
        <ul className="flex flex-col gap-2">
          {s.courts.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
              <span>
                <strong>Terrain {c.court}</strong> · {formatEuros(c.price_cents)} · payé par {name(c.booked_by)}
              </span>
              <form action={removeCourt.bind(null, c.id)}>
                <button type="submit" className="text-sm text-red-700 hover:underline dark:text-red-400">
                  Retirer
                </button>
              </form>
            </li>
          ))}
        </ul>
        {freeCourts.length > 0 && (
          <AddCourtForm
            sessionId={s.id}
            freeCourts={freeCourts}
            players={players}
            userId={userId}
            defaultPrice={lastPrice === undefined ? "" : formatPriceInput(lastPrice)}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Joueurs ({count}
          {count > 0 && <> · {formatEuros(shareCents(s.totalCents, count))} chacun</>})
        </h2>
        <ul className="flex flex-col gap-2">
          {s.participantIds.map((pid) => (
            <li key={pid} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
              <span>{name(pid)}</span>
              <form action={removeParticipant.bind(null, s.id, pid)}>
                <button type="submit" className="text-sm text-red-700 hover:underline dark:text-red-400">
                  Retirer
                </button>
              </form>
            </li>
          ))}
        </ul>
        {notPlaying.length > 0 && (
          <form action={addParticipantFromForm.bind(null, s.id)} className="flex gap-2">
            <select name="player_id" required className={inputClass} defaultValue="">
              <option value="" disabled>
                Ajouter un joueur…
              </option>
              {notPlaying.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <button type="submit" className={secondaryButton}>
              Ajouter
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Modifier la soirée</h2>
        <EditSessionForm id={s.id} venue={s.venue} date={start.date} start={start.time} end={end.time} notes={s.notes ?? ""} />
      </section>

      {s.created_by === userId && (
        <form action={deleteSession.bind(null, s.id)}>
          <ConfirmButton message="Supprimer cette soirée, ses terrains et ses inscriptions ?" className={dangerButton}>
            Supprimer la soirée
          </ConfirmButton>
        </form>
      )}
    </>
  );
}
