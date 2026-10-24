import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addParticipantFromForm, deleteSession, removeBooking, removeParticipant, setQrPath } from "@/app/sessions/actions";
import { AddBookingForm } from "@/components/add-booking-form";
import { AppHeader } from "@/components/app-header";
import { ConfirmButton } from "@/components/confirm-button";
import { EditSessionForm } from "@/components/edit-session-form";
import { QrUpload } from "@/components/qr-upload";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { groupByCourt } from "@/components/session-card";
import { SessionPlayers } from "@/components/session-players";
import { dangerButton, inputClass, secondaryButton } from "@/components/ui";
import { getPlayers, getSession, isPast } from "@/lib/data";
import { formatEuros, formatPriceInput, formatSlot, formatTimes, shareCents, toDateAndTime } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <RealtimeRefresh />
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Toutes les sessions
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Chargement…</p>}>
        <SessionDetails params={params} />
      </Suspense>
    </main>
  );
}

const linkButton = "text-sm text-red-700 hover:underline dark:text-red-400";

async function SessionDetails({ params }: { params: PageProps<"/sessions/[id]">["params"] }) {
  const { id } = await params;
  const { userId } = await requirePlayer();
  const [session, players] = await Promise.all([getSession(id), getPlayers()]);
  if (!session) notFound();

  const s = session;
  const playersById = new Map(players.map((p) => [p.id, p]));
  const name = (pid: string) => {
    const n = playersById.get(pid)?.display_name ?? "?";
    return pid === userId ? `${n} (vous)` : n;
  };
  const registered = new Set(s.players.map((p) => p.player_id));
  const notRegistered = players.filter((p) => !registered.has(p.id));
  const playingCount = s.players.filter((p) => p.is_playing).length;
  const start = toDateAndTime(s.starts_at);
  const end = toDateAndTime(s.ends_at);
  const lastPrice = s.bookings.at(-1)?.price_cents;
  const past = isPast(s);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{formatSlot(s.starts_at, s.ends_at)}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{s.venue}</p>
        {s.notes && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.notes}</p>}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Joueurs ({playingCount}/{s.capacity}
          {playingCount > 0 && <> · {formatEuros(shareCents(s.totalCents, playingCount))} chacun</>})
        </h2>
        <SessionPlayers session={s} players={playersById} userId={userId} canJoin={!past} />
        <ul className="flex flex-col gap-2">
          {s.players.map((p) => (
            <li key={p.player_id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
              <span>
                {p.position}. {name(p.player_id)}
                {!p.is_playing && <span className="text-sm text-amber-800 dark:text-amber-300"> · en attente</span>}
              </span>
              <form action={removeParticipant.bind(null, s.id, p.player_id)}>
                <button type="submit" className={linkButton}>
                  Retirer
                </button>
              </form>
            </li>
          ))}
        </ul>
        {notRegistered.length > 0 && (
          <form action={addParticipantFromForm.bind(null, s.id)} className="flex gap-2">
            <select name="player_id" required className={inputClass} defaultValue="" aria-label="Inscrire un joueur">
              <option value="" disabled>
                Inscrire un joueur…
              </option>
              {notRegistered.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <button type="submit" className={secondaryButton}>
              Inscrire
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Réservations · {formatEuros(s.totalCents)}</h2>
        <ul className="flex flex-col gap-3">
          {groupByCourt(s.bookings).map(([court, list]) => (
            <li key={court} className="flex flex-col gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
              <strong>Terrain {court}</strong>
              {list.map((b) => (
                <div key={b.id} className="flex flex-col gap-2 border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {formatTimes(b.starts_at, b.ends_at)} · {formatEuros(b.price_cents)} · payé par {name(b.booked_by)}
                      {b.co_payer && <> et {name(b.co_payer)} (moitié chacun)</>}
                    </span>
                    <form action={removeBooking.bind(null, b.id)}>
                      <ConfirmButton message={`Retirer le terrain ${court} (${formatTimes(b.starts_at, b.ends_at)}) ?`} className={linkButton}>
                        Retirer
                      </ConfirmButton>
                    </form>
                  </div>
                  {b.qrUrl && (
                    <a href={b.qrUrl} target="_blank" rel="noreferrer" className="self-start">
                      {b.qr_path?.endsWith(".pdf") ? (
                        <span className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">Ouvrir le QR code (PDF)</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.qrUrl} alt={`QR code du terrain ${court}`} className="max-h-48 rounded border border-zinc-200 bg-white" />
                      )}
                    </a>
                  )}
                  <div className="flex items-center gap-3">
                    <QrUpload bookingId={b.id} hasQr={Boolean(b.qr_path)} />
                    {b.qr_path && (
                      <form action={setQrPath.bind(null, b.id, null)}>
                        <button type="submit" className={linkButton}>
                          Supprimer le QR code
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ul>
        <AddBookingForm
          sessionId={s.id}
          date={start.date}
          start={start.time}
          end={end.time}
          players={players}
          userId={userId}
          defaultPrice={lastPrice === undefined ? "" : formatPriceInput(lastPrice)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Modifier la session</h2>
        <EditSessionForm id={s.id} venue={s.venue} notes={s.notes ?? ""} />
      </section>

      {s.created_by === userId && (
        <form action={deleteSession.bind(null, s.id)}>
          <ConfirmButton message="Supprimer cette session, ses réservations et ses inscriptions ?" className={dangerButton}>
            Supprimer la session
          </ConfirmButton>
        </form>
      )}
    </>
  );
}
