import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { NewSessionForm } from "@/components/new-session-form";
import { getLastDefaults, getPlayers } from "@/lib/data";
import { formatPriceInput } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function NewSessionPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <h1 className="text-2xl font-semibold">Nouvelle soirée</h1>
      <Suspense fallback={<p className="text-zinc-500">Chargement…</p>}>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  const { userId } = await requirePlayer();
  const [players, defaults] = await Promise.all([getPlayers(), getLastDefaults()]);
  return (
    <NewSessionForm
      players={players}
      userId={userId}
      defaultVenue={defaults.venue}
      defaultPrice={defaults.priceCents === null ? "" : formatPriceInput(defaults.priceCents)}
    />
  );
}
