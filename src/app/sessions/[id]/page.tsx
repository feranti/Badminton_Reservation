import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, StickyFooter, SubPage } from "@/components/app-shell";
import { QrIcon } from "@/components/icons";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { groupByCourt, sessionStatus } from "@/components/session-card";
import { JoinButton, SessionPlayers } from "@/components/session-players";
import { card, sectionTitle } from "@/components/ui";
import { getPlayers, getSession, isPast } from "@/lib/data";
import { formatDay, formatEuros, formatTimes, shareCents } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  return (
    <Suspense fallback={<Loading />}>
      <SessionDetails params={params} />
    </Suspense>
  );
}

async function SessionDetails({ params }: { params: PageProps<"/sessions/[id]">["params"] }) {
  const { id } = await params;
  const { userId } = await requirePlayer();
  const [session, players] = await Promise.all([getSession(id), getPlayers()]);
  if (!session) notFound();

  const s = session;
  const playersById = new Map(players.map((p) => [p.id, p]));
  const name = (pid: string) => (pid === userId ? "vous" : (playersById.get(pid)?.display_name ?? "?"));
  const { playing } = sessionStatus(s, userId);
  const courts = groupByCourt(s.bookings);
  const past = isPast(s);
  const payers = [...new Set(s.bookings.flatMap((b) => [b.booked_by, b.co_payer]).filter((p): p is string => Boolean(p)))];
  const payersText = payers.map(name).join(", ").replace(/, ([^,]*)$/, " et $1");
  const qrs = s.bookings.filter((b) => b.qrUrl);

  return (
    <SubPage
      back={past ? "/?passees=1" : "/"}
      withFooter={!past}
      right={
        <Link href={`/sessions/${s.id}/gerer`} className="flex min-h-11 items-center px-3 text-[15px] font-medium text-ink">
          Gérer
        </Link>
      }
    >
      <RealtimeRefresh />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{formatDay(s.starts_at)}</h1>
        <p className="text-muted">
          {formatTimes(s.starts_at, s.ends_at)} · {s.venue}
        </p>
        {s.notes && <p className="mt-1 text-[15px]">{s.notes}</p>}
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {[
          [courts.length > 1 ? "Terrains" : "Terrain", courts.map(([c]) => c).join(" · ")],
          ["Joueurs", `${playing} / ${s.capacity}`],
          ["Par joueur", playing > 0 ? formatEuros(shareCents(s.totalCents, playing)) : "–"],
        ].map(([label, value]) => (
          <div key={label} className={`${card} flex flex-col gap-1 rounded-xl p-3`}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-[17px] font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Joueurs</h2>
        <SessionPlayers session={s} players={playersById} userId={userId} />
      </section>

      {qrs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>QR codes d&apos;entrée</h2>
          <div className="grid grid-cols-2 gap-2">
            {qrs.map((b) => (
              <a
                key={b.id}
                href={b.qrUrl!}
                target="_blank"
                rel="noreferrer"
                className={`${card} flex min-h-14 items-center justify-center gap-2 rounded-xl text-[15px] font-medium`}
              >
                <QrIcon />
                Terrain {b.court}
                {courts.find(([c]) => c === b.court)![1].length > 1 && (
                  <span className="text-muted"> · {formatTimes(b.starts_at, b.ends_at).split(" ")[0]}</span>
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      <p className="text-sm text-muted">
        Réservé par {payersText} · {formatEuros(s.totalCents)}
      </p>

      {!past && (
        <StickyFooter>
          <JoinButton session={s} userId={userId} />
        </StickyFooter>
      )}
    </SubPage>
  );
}
