export type Transfer = { from: string; to: string; cents: number };

// Transforme les soldes (positif = on lui doit) en une liste courte de virements.
// Méthode : le plus gros débiteur rembourse le plus gros créancier, et ainsi de suite.
// Les écarts d'un centime dus aux arrondis sont ignorés.
export function simplifyDebts(balances: { player_id: string; balance_cents: number }[]): Transfer[] {
  const creditors = balances.filter((b) => b.balance_cents > 1).map((b) => ({ id: b.player_id, cents: b.balance_cents }));
  const debtors = balances.filter((b) => b.balance_cents < -1).map((b) => ({ id: b.player_id, cents: -b.balance_cents }));
  const transfers: Transfer[] = [];

  while (creditors.length && debtors.length) {
    creditors.sort((a, b) => b.cents - a.cents);
    debtors.sort((a, b) => b.cents - a.cents);
    const creditor = creditors[0];
    const debtor = debtors[0];
    const cents = Math.min(creditor.cents, debtor.cents);
    if (cents > 1) transfers.push({ from: debtor.id, to: creditor.id, cents });
    creditor.cents -= cents;
    debtor.cents -= cents;
    if (creditor.cents <= 1) creditors.shift();
    if (debtor.cents <= 1) debtors.shift();
  }
  return transfers;
}
