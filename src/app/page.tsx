import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { SessionCard } from "@/components/session-card";
import { primaryButton } from "@/components/ui";
import { getPlayers, getSessions } from "@/lib/data";
import { requirePlayer } from "@/lib/session";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <RealtimeRefresh />
      <Suspense fallback={<p className="text-zinc-500">Chargement…</p>}>
        <SessionList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SessionList({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const past = (await searchParams).passees === "1";
  const { userId } = await requirePlayer();
  const [sessions, players] = await Promise.all([getSessions(past), getPlayers()]);
  const playersById = new Map(players.map((p) => [p.id, p]));
  const me = playersById.get(userId);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Bonjour {me?.display_name}</p>
          <h1 className="text-2xl font-semibold">{past ? "Soirées passées" : "Prochaines soirées"}</h1>
        </div>
        <Link href="/soirees/nouvelle" className={primaryButton}>
          + Ajouter
        </Link>
      </div>

      <Link href={past ? "/" : "/?passees=1"} className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        {past ? "← Voir les soirées à venir" : "Voir les soirées passées"}
      </Link>

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-zinc-500 dark:border-zinc-700">
          {past ? "Aucune soirée passée." : "Aucune soirée prévue. Ajoutez la prochaine !"}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} players={playersById} userId={userId} past={past} />
          ))}
        </ul>
      )}
    </>
  );
}
