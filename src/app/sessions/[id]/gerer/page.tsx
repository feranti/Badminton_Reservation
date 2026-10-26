import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addParticipantFromForm, deleteSession, removeBooking, removeParticipant, setQrPath } from "@/app/sessions/actions";
import { AddBookingForm } from "@/components/add-booking-form";
import { Loading, SubPage } from "@/components/app-shell";
import { ConfirmButton } from "@/components/confirm-button";
import { EditSessionForm } from "@/components/edit-session-form";
import { CheckIcon, TrashIcon } from "@/components/icons";
import { QrUpload } from "@/components/qr-upload";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { groupByCourt, sessionStatus } from "@/components/session-card";
import { card, dangerText, inputClass, quietButton, secondaryButton, sectionTitle, textButton } from "@/components/ui";
import { getPlayers, getSession } from "@/lib/data";
import { formatDay, formatEuros, formatPriceInput, formatTimes, toDateAndTime } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function ManageSessionPage({ params }: PageProps<"/sessions/[id]/gerer">) {
  return (
    <Suspense fallback={<Loading />}>
      <ManageSession params={params} />
    </Suspense>
  );
}

async function ManageSession({ params }: { params: PageProps<"/sessions/[id]/gerer">["params"] }) {
  const { id } = await params;
  const { userId } = await requirePlayer();
  const [session, players] = await Promise.all([getSession(id), getPlayers()]);
  if (!session) notFound();

  const s = session;
  const playersById = new Map(players.map((p) => [p.id, p]));
  const name = (pid: string) => playersById.get(pid)?.display_name ?? "?";
  const registered = new Set(s.players.map((p) => p.player_id));
  const notRegistered = players.filter((p) => !registered.has(p.id));
  const { playing } = sessionStatus(s, userId);
  const start = toDateAndTime(s.starts_at);
  const end = toDateAndTime(s.ends_at);
  const lastPrice = s.bookings.at(-1)?.price_cents;
  const back = `/sessions/${s.id}`;

  return (
    <SubPage
      back={back}
      title={`Gérer · ${formatDay(s.starts_at, true)}`}
      right={
        <Link href={back} className="flex min-h-11 items-center px-3 text-[15px] font-semibold text-accent">
          OK
        </Link>
      }
    >
      <RealtimeRefresh />
      <section className="flex flex-col gap-2">
        <h2 className={`${sectionTitle} mb-1`}>Terrains · {formatEuros(s.totalCents)}</h2>
        {groupByCourt(s.bookings).flatMap(([court, list]) =>
          list.map((b) => (
            <div key={b.id} className={`${card} flex flex-col gap-2 p-4`}>
              <div className="flex items-center justify-between">
                <span className="text-[17px] font-semibold">Terrain {court}</span>
                <form action={removeBooking.bind(null, b.id)}>
                  <ConfirmButton
                    message={`Retirer le terrain ${court} (${formatTimes(b.starts_at, b.ends_at)}) ?`}
                    label={`Retirer le terrain ${court} (${formatTimes(b.starts_at, b.ends_at)})`}
                    className="-m-2.5 flex size-11 items-center justify-center text-faint hover:text-danger"
                  >
                    <TrashIcon />
                  </ConfirmButton>
                </form>
              </div>
              <p className="text-sm text-muted">
                {formatTimes(b.starts_at, b.ends_at)} · {formatEuros(b.price_cents)} · payé par {name(b.booked_by)}
                {b.co_payer && <> et {name(b.co_payer)} (moitié chacun)</>}
              </p>
              {b.qr_path ? (
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-accent-ink">
                    <CheckIcon />
                    QR code ajouté
                  </span>
                  {b.qrUrl && (
                    <a href={b.qrUrl} target="_blank" rel="noreferrer" className={textButton}>
                      Voir
                    </a>
                  )}
                  <span className="ml-auto flex items-center gap-3">
                    <QrUpload bookingId={b.id} hasQr />
                    <form action={setQrPath.bind(null, b.id, null)}>
                      <button type="submit" className={quietButton}>
                        Supprimer
                      </button>
                    </form>
                  </span>
                </div>
              ) : (
                <QrUpload bookingId={b.id} hasQr={false} />
              )}
            </div>
          )),
        )}
        <details className="group">
          <summary className={`${textButton} cursor-pointer px-1 text-[15px] group-open:text-muted`}>+ Ajouter un terrain</summary>
          <AddBookingForm
            sessionId={s.id}
            date={start.date}
            start={start.time}
            end={end.time}
            players={players}
            userId={userId}
            defaultPrice={lastPrice === undefined ? "" : formatPriceInput(lastPrice)}
          />
        </details>
      </section>

      <section className="flex flex-col">
        <h2 className={`${sectionTitle} mb-2`}>
          Joueurs · {playing} / {s.capacity}
        </h2>
        <ul className="flex flex-col">
          {s.players.map((p) => (
            <li key={p.player_id} className="flex min-h-12 items-center justify-between border-b border-line">
              <span>
                {name(p.player_id)}
                {p.player_id === userId && <span className="text-muted"> (vous)</span>}
                {!p.is_playing && <span className="text-sm text-warn"> · en attente</span>}
              </span>
              <form action={removeParticipant.bind(null, s.id, p.player_id)}>
                <button type="submit" className={quietButton} aria-label={`Retirer ${name(p.player_id)}`}>
                  Retirer
                </button>
              </form>
            </li>
          ))}
        </ul>
        {notRegistered.length > 0 && (
          <form action={addParticipantFromForm.bind(null, s.id)} className="mt-4 flex gap-2">
            <select name="player_id" required className={inputClass} defaultValue="" aria-label="Inscrire quelqu'un">
              <option value="" disabled>
                Inscrire quelqu&apos;un…
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
        <h2 className={sectionTitle}>Session</h2>
        <EditSessionForm id={s.id} venue={s.venue} notes={s.notes ?? ""} />
      </section>

      {s.created_by === userId && (
        <form action={deleteSession.bind(null, s.id)} className="flex justify-center">
          <ConfirmButton message="Supprimer cette session, ses réservations et ses inscriptions ?" className={dangerText}>
            Supprimer la session
          </ConfirmButton>
        </form>
      )}
    </SubPage>
  );
}
