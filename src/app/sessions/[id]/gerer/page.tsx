import { notFound } from "next/navigation";
import { Suspense } from "react";
import { addParticipantFromForm, deleteSession, removeBooking, removeParticipant, removePartner, setQrPath } from "@/app/sessions/actions";
import { AddBookingForm } from "@/components/add-booking-form";
import { Loading, SubPage } from "@/components/app-shell";
import { ConfirmButton } from "@/components/confirm-button";
import { EditPayersForm } from "@/components/edit-payers-form";
import { EditPriceForm } from "@/components/edit-price-form";
import { EditSessionForm, SessionDoneButton } from "@/components/edit-session-form";
import { TrashIcon } from "@/components/icons";
import { QrUpload } from "@/components/qr-upload";
import { QrViewer } from "@/components/qr-viewer";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { groupByCourt, sessionStatus } from "@/components/session-card";
import { card, dangerText, inputClass, quietButton, secondaryButton, sectionTitle, textButton } from "@/components/ui";
import { bookingHours } from "@/lib/courts";
import { getPlayers, getSession } from "@/lib/data";
import { formatDay, formatEuros, formatTimes, toDateAndTime } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function ManageSessionPage({ params }: PageProps<"/sessions/[id]/gerer">) {
  return (
    <Suspense fallback={<Loading variant="form" alone />}>
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
  const back = `/sessions/${s.id}`;
  const cardTag = (on: boolean) => (
    <span className="rounded-md bg-chip px-1.5 py-0.5 text-xs">{on ? "carte" : "sans carte"}</span>
  );

  return (
    <SubPage
      back={back}
      title={`Gérer · ${formatDay(s.starts_at, true)}`}
      right={<SessionDoneButton />}
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
              {b.card_pricing ? (
                <>
                  <p className="text-sm text-muted">
                    {formatTimes(b.starts_at, b.ends_at)} · {formatEuros(b.price_cents)} · {name(b.booked_by)} {cardTag(b.booked_by_card)}
                    {b.co_payer ? (
                      <>
                        {" "}+ {name(b.co_payer)} {cardTag(b.co_payer_card)}
                      </>
                    ) : (
                      " · seul"
                    )}
                  </p>
                  {!b.co_payer && (
                    <p className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn-ink">
                      Supplément de 5 € l&apos;heure pour le 2e joueur absent, payé par le capitaine.
                    </p>
                  )}
                  {/* Le 2e joueur annule sa réservation : le capitaine paie le supplément. Si le capitaine
                      annule, le gymnase annule le terrain : on le retire avec la corbeille. */}
                  {b.co_payer && (
                    <form action={removePartner.bind(null, b.id)}>
                      <button type="submit" className={secondaryButton}>
                        Retirer {name(b.co_payer)} (2e joueur)
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">
                  {formatTimes(b.starts_at, b.ends_at)} · {formatEuros(b.price_cents)} · payé par {name(b.booked_by)}
                  {b.co_payer && <> et {name(b.co_payer)} (moitié chacun)</>}
                </p>
              )}
              <div className="flex flex-col">
                <EditPayersForm
                  key={`${b.booked_by}-${b.co_payer}-${b.booked_by_card}-${b.co_payer_card}-${b.card_pricing}`}
                  bookingId={b.id}
                  label={`terrain ${court} (${formatTimes(b.starts_at, b.ends_at)})`}
                  players={players}
                  userId={userId}
                  cardPricing={b.card_pricing}
                  bookedBy={b.booked_by}
                  coPayer={b.co_payer}
                  bookedByCard={b.booked_by_card}
                  coPayerCard={b.co_payer_card}
                />
                <EditPriceForm
                  key={b.price_cents}
                  bookingId={b.id}
                  priceCents={b.price_cents}
                  label={`terrain ${court} (${formatTimes(b.starts_at, b.ends_at)})`}
                />
              </div>
              {/* Un QR code par heure, en tuiles de deux par ligne ; l'heure n'est précisée que si le terrain en a plusieurs. */}
              <div className="grid grid-cols-2 gap-2">
                {bookingHours(b).map((h, _, hours) => {
                  const qr = b.qrs.find((q) => q.hour === h.hour);
                  const label = hours.length > 1 ? formatTimes(h.startsAt, h.endsAt) : undefined;
                  return (
                    <div
                      key={h.hour}
                      className={`flex flex-col rounded-xl px-3 pt-2 pb-0.5 ${hours.length === 1 ? "col-span-2" : ""} ${
                        qr ? "bg-accent-tint" : "border border-dashed border-dash"
                      }`}
                    >
                      <span className="flex min-h-7 items-center justify-between gap-2">
                        {/* Le fond vert suffit à signaler le QR code ajouté. */}
                        <span className={`text-sm font-medium whitespace-nowrap ${qr ? "text-accent-ink" : "text-muted"}`}>
                          {label ?? "QR code"}
                        </span>
                        {qr && (
                          <form action={setQrPath.bind(null, b.id, h.hour, null)}>
                            <button
                              type="submit"
                              aria-label={`Supprimer le QR code${label ? ` · ${label}` : ""}`}
                              className="-my-2 -mr-2.5 flex size-11 items-center justify-center text-faint hover:text-danger"
                            >
                              <TrashIcon />
                            </button>
                          </form>
                        )}
                      </span>
                      <QrUpload bookingId={b.id} hour={h.hour} label={label} hasQr={Boolean(qr)}>
                        {qr?.url && (
                          <QrViewer
                            url={qr.url}
                            path={qr.path}
                            title={`QR code · Terrain ${court}${label ? ` · ${label}` : ""}`}
                            className={`${textButton} cursor-pointer`}
                          >
                            Voir
                          </QrViewer>
                        )}
                      </QrUpload>
                    </div>
                  );
                })}
              </div>
            </div>
          )),
        )}
        {/* Ouvert, le formulaire devient un cadre en pointillés pour le distinguer des terrains réservés. */}
        <details className="group rounded-2xl border border-dashed border-transparent open:mt-1 open:border-dash open:bg-surface open:px-4 open:pb-4">
          <summary className={`${textButton} cursor-pointer px-1 text-[15px] group-open:-mx-1 group-open:text-muted`}>+ Ajouter un terrain</summary>
          <AddBookingForm
            sessionId={s.id}
            venue={s.venue}
            date={start.date}
            start={start.time}
            end={end.time}
            players={players}
            userId={userId}
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
                {p.guests > 0 && (
                  <span className="text-muted">
                    {" "}
                    +{p.guests} invité{p.guests > 1 ? "s" : ""}
                  </span>
                )}
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
