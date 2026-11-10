import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading, SubPage } from "@/components/app-shell";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { SessionHistory } from "@/components/session-history";
import { getPlayers, getSession, getSessionEvents } from "@/lib/data";
import { formatDay, formatTimes } from "@/lib/format";
import { FILTERS, type Filter } from "@/lib/history";
import { requirePlayer } from "@/lib/session";

export default function HistoryPage({ params, searchParams }: PageProps<"/sessions/[id]/historique">) {
  return (
    <Suspense fallback={<Loading alone />}>
      <History params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function History({
  params,
  searchParams,
}: {
  params: PageProps<"/sessions/[id]/historique">["params"];
  searchParams: PageProps<"/sessions/[id]/historique">["searchParams"];
}) {
  const { id } = await params;
  const filtre = (await searchParams).filtre;
  const filter = typeof filtre === "string" && filtre in FILTERS ? (filtre as Filter) : null;
  await requirePlayer();
  const [session, players, { events }] = await Promise.all([getSession(id, { cancelled: true }), getPlayers(), getSessionEvents(id)]);
  if (!session) notFound();

  const kinds: readonly string[] | null = filter ? FILTERS[filter].kinds : null;
  const shown = kinds ? events.filter((e) => kinds.includes(e.kind)) : events;
  const repris = events.some((e) => e.details && typeof e.details === "object" && "repris" in e.details);
  const chip = (on: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm ${
      on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-ink"
    }`;
  const base = `/sessions/${session.id}/historique`;

  return (
    <SubPage back={`/sessions/${session.id}`} title="Historique">
      <RealtimeRefresh />
      <p className="text-muted">
        {formatDay(session.starts_at)} · {formatTimes(session.starts_at, session.ends_at)}
      </p>
      <nav aria-label="Filtrer l'historique" className="-mx-5 flex gap-2 overflow-x-auto px-5">
        <Link href={base} replace scroll={false} className={chip(!filter)} aria-current={!filter ? "page" : undefined}>
          Tout
        </Link>
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Link key={f} href={`${base}?filtre=${f}`} replace scroll={false} className={chip(filter === f)} aria-current={filter === f ? "page" : undefined}>
            {FILTERS[f].label}
          </Link>
        ))}
      </nav>
      {shown.length > 0 ? (
        <SessionHistory events={shown} names={new Map(players.map((p) => [p.id, p.display_name]))} grouped />
      ) : (
        <p className="text-muted">Rien pour l&apos;instant.</p>
      )}
      {repris && (
        <p className="text-sm text-faint">
          Les événements d&apos;avant la mise en place de l&apos;historique sont reconstitués : seuls la création, les
          terrains et les inscriptions encore présents y figurent.
        </p>
      )}
    </SubPage>
  );
}
