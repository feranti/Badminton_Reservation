import Link from "next/link";
import { Suspense } from "react";
import { Loading, TabPage } from "@/components/app-shell";
import { ChevronDownIcon } from "@/components/icons";
import { PaymentForm } from "@/components/payment-form";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { card, primaryButton, quietButton, secondaryButton, sectionTitle } from "@/components/ui";
import { getBalances, getPayments, getPlayers } from "@/lib/data";
import { formatEuros } from "@/lib/format";
import { requirePlayer } from "@/lib/session";
import { simplifyDebts } from "@/lib/settle";
import { cancelPayment, confirmPayment, declareTransfer } from "./actions";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });

export default function AccountsPage() {
  return (
    <TabPage title="Comptes" tab="comptes">
      <RealtimeRefresh />
      <Suspense fallback={<Loading />}>
        <Accounts />
      </Suspense>
    </TabPage>
  );
}

// Section repliée par défaut, pour les informations consultées moins souvent.
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-line">
      <summary className="flex min-h-13 cursor-pointer items-center justify-between">
        {title}
        <ChevronDownIcon className="size-5 text-faint transition group-open:rotate-180" />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
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
  const myTransfers = transfers.filter((t) => t.from === userId || t.to === userId);
  const others = transfers.filter((t) => t.from !== userId && t.to !== userId);
  const nothingToDo = toConfirm.length === 0 && myTransfers.length === 0;

  return (
    <>
      <div className="flex flex-col gap-1 py-2">
        <span className="text-sm text-muted">Votre solde</span>
        <span
          className={`text-[40px] leading-tight font-semibold tracking-tight ${
            mine > 1 ? "text-accent-ink" : mine < -1 ? "text-warn" : ""
          }`}
        >
          {mine > 1 ? "+" : ""}
          {formatEuros(Math.abs(mine) > 1 ? mine : 0)}
        </span>
        <span className="text-[15px] text-muted">
          {mine > 1 ? `On vous doit ${formatEuros(mine)}` : mine < -1 ? `Vous devez ${formatEuros(-mine)}` : "Vous êtes à jour"}
          {" · "}
          <Link href="/comptes/aide" className="text-accent hover:underline">
            Comment c&apos;est calculé ?
          </Link>
        </span>
      </div>

      <section className="flex flex-col gap-2.5">
        <h2 className={sectionTitle}>À faire</h2>
        {nothingToDo && <p className="text-muted">Rien à faire pour l&apos;instant.</p>}
        {toConfirm.map((p) => (
          <div key={p.id} className={`${card} flex flex-col gap-3.5 p-4`}>
            <p>
              {Name(p.from_player)} dit vous avoir remboursé <strong className="font-semibold">{formatEuros(p.amount_cents)}</strong>
              {p.note && <span className="text-muted"> ({p.note})</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <form action={confirmPayment.bind(null, p.id)}>
                <button type="submit" className={`${primaryButton} min-h-11 w-full`}>
                  Bien reçu
                </button>
              </form>
              <form action={cancelPayment.bind(null, p.id)}>
                <button type="submit" className={`${secondaryButton} w-full`}>
                  Pas reçu
                </button>
              </form>
            </div>
          </div>
        ))}
        {myTransfers.map((t) => {
          const iPay = t.from === userId;
          return (
            <div key={`${t.from}-${t.to}`} className={`${card} flex flex-col gap-3.5 p-4`}>
              <p>
                {iPay ? (
                  <>
                    Rembourser <strong className="font-semibold">{formatEuros(t.cents)}</strong> à {name(t.to)}
                  </>
                ) : (
                  <>
                    {Name(t.from)} vous doit <strong className="font-semibold">{formatEuros(t.cents)}</strong>
                  </>
                )}
              </p>
              {isPending(t.from, t.to) ? (
                <p className="text-sm text-muted">Remboursement signalé, en attente de confirmation.</p>
              ) : (
                <form action={declareTransfer.bind(null, t.from, t.to, t.cents)}>
                  <button type="submit" className={`${iPay ? primaryButton : secondaryButton} min-h-11 w-full`}>
                    {iPay ? `C'est fait, j'ai payé ${formatEuros(t.cents)}` : `J'ai reçu ${formatEuros(t.cents)}`}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex flex-col">
        <Fold title="Soldes de chacun">
          <ul className="flex flex-col">
            {balances.map((b) => (
              <li key={b.player_id} className="flex justify-between py-1.5">
                <span>
                  {b.display_name}
                  {b.player_id === userId && <span className="text-muted"> (vous)</span>}
                </span>
                <span className={b.balance_cents > 1 ? "text-accent-ink" : b.balance_cents < -1 ? "text-warn" : "text-muted"}>
                  {b.balance_cents > 1 ? "+" : ""}
                  {formatEuros(Math.abs(b.balance_cents) > 1 ? b.balance_cents : 0)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Positif : on lui doit de l&apos;argent. Négatif : il en doit.</p>
        </Fold>
        {others.length > 0 && (
          <Fold title="Entre les autres joueurs">
            <ul className="flex flex-col gap-1.5">
              {others.map((t) => (
                <li key={`${t.from}-${t.to}`}>
                  {Name(t.from)} doit <strong className="font-semibold">{formatEuros(t.cents)}</strong> à {name(t.to)}
                  {isPending(t.from, t.to) && <span className="text-sm text-muted"> · signalé</span>}
                </li>
              ))}
            </ul>
          </Fold>
        )}
        {payments.length > 0 && (
          <Fold title="Historique">
            <ul className="flex flex-col text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex min-h-11 items-center justify-between gap-2 border-b border-line last:border-0">
                  <span>
                    <span className="text-muted">{dateFormat.format(new Date(p.created_at))}</span> · {Name(p.from_player)} →{" "}
                    {name(p.to_player)} · <strong className="font-semibold">{formatEuros(p.amount_cents)}</strong>
                    {p.note && <span className="text-muted"> · {p.note}</span>}
                  </span>
                  {p.confirmed_at ? (
                    <span className="text-accent-ink">Confirmé</span>
                  ) : p.created_by === userId ? (
                    <form action={cancelPayment.bind(null, p.id)}>
                      <button type="submit" className="min-h-11 text-danger hover:underline">
                        Annuler
                      </button>
                    </form>
                  ) : (
                    <span className="text-warn">En attente</span>
                  )}
                </li>
              ))}
            </ul>
          </Fold>
        )}
        <Fold title="Signaler un autre remboursement">
          <PaymentForm players={players} userId={userId} />
        </Fold>
      </section>

      <Link href="/comptes/aide" className={`${quietButton} self-center`}>
        Comment sont calculés les comptes ?
      </Link>
    </>
  );
}
