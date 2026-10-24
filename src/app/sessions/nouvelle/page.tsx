import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { NewBookingForm } from "@/components/new-booking-form";
import { getLastDefaults, getPlayers } from "@/lib/data";
import { formatPriceInput } from "@/lib/format";
import { requirePlayer } from "@/lib/session";

export default function NewBookingPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <div>
        <h1 className="text-2xl font-semibold">Nouvelle réservation</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Les terrains réservés sur des créneaux qui se suivent sont regroupés dans la même session.
        </p>
      </div>
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
    <NewBookingForm
      players={players}
      userId={userId}
      defaultVenue={defaults.venue}
      defaultPrice={defaults.priceCents === null ? "" : formatPriceInput(defaults.priceCents)}
    />
  );
}
