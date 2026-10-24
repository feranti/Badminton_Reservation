import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { PaymentForm } from "@/components/payment-form";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { primaryButton, secondaryButton } from "@/components/ui";
import { getBalances, getPayments, getPlayers } from "@/lib/data";
import { formatEuros } from "@/lib/format";
import { requirePlayer } from "@/lib/session";
import { simplifyDebts } from "@/lib/settle";
import { cancelPayment, confirmPayment, declareTransfer } from "./actions";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });

export default function AccountsPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <RealtimeRefresh />
      <h1 className="text-2xl font-semibold">Comptes</h1>
      <Suspense fallback={<p className="text-zinc-500">Chargement…</p>}>
        <Accounts />
      </Suspense>
    </main>
  );
}

async function Accounts() {
  const { userId } = await requirePlayer();
  const [balances, payments, players] = await Promise.all([getBalances(), getPayments(), getPlayers()]);
  const name = (id: string) => (id === userId ? "vous" : (players.find((p) => p.id === id)?.display_name ?? "?"));
  const Name = (id: string) => {
    const n = name(id);
    return n.charAt(0).toUpperCase() + n.slice(1);
  };

  const mine = balances.find((b) => b.player_id === userId)?.balance_cents ?? 0;
  const transfers = simplifyDebts(balances);
  const pending = payments.filter((p) => !p.confirmed_at);
  const toConfirm = pending.filter((p) => p.to_player === userId);
  const isPending = (from: string, to: string) => pending.some((p) => p.from_player === from && p.to_player === to);

  return (
    <>
      <section
        className={`rounded-xl p-4 ${
          mine > 1
            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
            : mine < -1
              ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "bg-zinc-50 dark:bg-zinc-900"
        }`}
      >
        <p className="text-sm">Votre solde</p>
        <p className="text-2xl font-semibold">
          {mine > 1 ? `On vous doit ${formatEuros(mine)}` : mine < -1 ? `Vous devez ${formatEuros(-mine)}` : "Vous êtes à jour"}
        </p>
      </section>

      {toConfirm.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">À confirmer</h2>
          {toConfirm.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-amber-300 p-3 dark:border-amber-800">
              <p>
                {Name(p.from_player)} dit vous avoir remboursé <strong>{formatEuros(p.amount_cents)}</strong>
                {p.note && <> ({p.note})</>}.
              </p>
              <div className="flex gap-2">
                <form action={confirmPayment.bind(null, p.id)}>
                  <button type="submit" className={primaryButton}>
                    Je confirme
                  </button>
                </form>
                <form action={cancelPayment.bind(null, p.id)}>
                  <button type="submit" className={secondaryButton}>
                    Je n&apos;ai rien reçu
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Qui doit combien à qui</h2>
        {transfers.length === 0 ? (
          <p className="text-zinc-500">Tout le monde est à jour.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {transfers.map((t) => (
              <li key={`${t.from}-${t.to}`} className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p>
                  {Name(t.from)} {t.from === userId ? "devez" : "doit"} <strong>{formatEuros(t.cents)}</strong> à {name(t.to)}
                </p>
                {isPending(t.from, t.to) ? (
                  <p className="text-sm text-zinc-500">Remboursement signalé, en attente de confirmation.</p>
                ) : t.from === userId ? (
                  <form action={declareTransfer.bind(null, t.from, t.to, t.cents)}>
                    <button type="submit" className={secondaryButton}>
                      J&apos;ai payé {formatEuros(t.cents)}
                    </button>
                  </form>
                ) : t.to === userId ? (
                  <form action={declareTransfer.bind(null, t.from, t.to, t.cents)}>
                    <button type="submit" className={secondaryButton}>
                      J&apos;ai reçu {formatEuros(t.cents)}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Signaler un autre remboursement</h2>
        <PaymentForm players={players} userId={userId} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Soldes de chacun</h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {balances.map((b) => (
            <li key={b.player_id} className="flex justify-between px-3 py-2">
              <span>{b.player_id === userId ? `${b.display_name} (vous)` : b.display_name}</span>
              <span
                className={
                  b.balance_cents > 1 ? "text-emerald-700 dark:text-emerald-400" : b.balance_cents < -1 ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"
                }
              >
                {b.balance_cents > 0 ? "+" : ""}
                {formatEuros(b.balance_cents)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-500">Positif : on lui doit de l&apos;argent. Négatif : il doit de l&apos;argent.</p>
      </section>

      {payments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Historique des remboursements</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                <span>
                  {dateFormat.format(new Date(p.created_at))} · {Name(p.from_player)} → {name(p.to_player)} ·{" "}
                  <strong>{formatEuros(p.amount_cents)}</strong>
                  {p.note && <> · {p.note}</>}
                </span>
                {p.confirmed_at ? (
                  <span className="text-emerald-700 dark:text-emerald-400">Confirmé</span>
                ) : p.created_by === userId ? (
                  <form action={cancelPayment.bind(null, p.id)}>
                    <button type="submit" className="text-red-700 hover:underline dark:text-red-400">
                      Annuler
                    </button>
                  </form>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">En attente</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
