import Link from "next/link";
import { Suspense } from "react";
import { Loading, TabPage } from "@/components/app-shell";
import { ChevronIcon } from "@/components/icons";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { NextSessionCard, SessionRow } from "@/components/session-card";
import { primaryButton, quietButton, sectionTitle } from "@/components/ui";
import { getBalances, getPlayers, getSessions } from "@/lib/data";
import { formatEuros } from "@/lib/format";
import { requirePlayer } from "@/lib/session";
import { simplifyDebts } from "@/lib/settle";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <TabPage title="Résas" tab="sessions">
      <RealtimeRefresh />
      <Suspense fallback={<Loading />}>
        <SessionList searchParams={searchParams} />
      </Suspense>
    </TabPage>
  );
}

async function SessionList({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const past = (await searchParams).passees === "1";
  const { userId } = await requirePlayer();
  const [sessions, players, balances] = await Promise.all([getSessions(past), getPlayers(), getBalances()]);
  const myBalance = balances.find((b) => b.player_id === userId)?.balance_cents ?? 0;
  const name = (id: string) => players.find((p) => p.id === id)?.display_name ?? "?";
  const myDebts = simplifyDebts(balances).filter((t) => t.from === userId);

  if (past) {
    return (
      <>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Sessions passées</h1>
          <Link href="/" className={quietButton}>
            À venir
          </Link>
        </div>
        {sessions.length === 0 ? (
          <p className="py-10 text-center text-muted">Aucune session passée.</p>
        ) : (
          <ul className="flex flex-col">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} userId={userId} past />
            ))}
          </ul>
        )}
      </>
    );
  }

  const [next, ...later] = sessions;
  return (
    <>
      <h1 className="sr-only">Prochaines sessions</h1>
      {Math.abs(myBalance) > 1 && (
        <Link
          href="/comptes"
          className={`flex min-h-12 items-center justify-between gap-3 rounded-xl px-4 py-3 text-[15px] ${
            myBalance > 0 ? "bg-accent-tint text-accent-ink" : "bg-warn-bg text-warn-ink"
          }`}
        >
          <span>
            {myBalance > 0 ? (
              <>
                On vous doit <strong className="font-semibold">{formatEuros(myBalance)}</strong>
              </>
            ) : (
              <>
                Vous devez <strong className="font-semibold">{formatEuros(-myBalance)}</strong>
                {myDebts.length === 1 && <> à {name(myDebts[0].to)}</>}
              </>
            )}
          </span>
          <ChevronIcon />
        </Link>
      )}

      {!next ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted">Aucune session prévue.</p>
          <Link href="/sessions/nouvelle" className={primaryButton}>
            Réserver un terrain
          </Link>
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className={sectionTitle}>Prochaine session</h2>
          <NextSessionCard session={next} userId={userId} />
        </section>
      )}

      {later.length > 0 && (
        <section className="flex flex-col">
          <h2 className={`${sectionTitle} mb-2`}>Ensuite</h2>
          <ul className="flex flex-col">
            {later.map((s) => (
              <SessionRow key={s.id} session={s} userId={userId} past={false} />
            ))}
          </ul>
        </section>
      )}

      <Link href="/?passees=1" className={`${quietButton} self-center`}>
        Sessions passées
      </Link>
    </>
  );
}
