-- Un remboursement ne peut être déclaré déjà confirmé que par celui qui le reçoit.
-- (Sinon le payeur pourrait se déclarer remboursé sans l'accord du bénéficiaire.)
drop policy "payments: déclarer (payeur ou bénéficiaire)" on public.payments;
create policy "payments: déclarer (payeur ou bénéficiaire)" on public.payments
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select auth.uid()) in (from_player, to_player)
    and (confirmed_at is null or to_player = (select auth.uid()))
  );

create index payments_created_at_idx on public.payments (created_at desc);

-- Un remboursement en attente peut être annulé par celui qui l'a déclaré
-- ou refusé par celui qui devait le recevoir.
drop policy "payments: supprimer tant que non confirmé" on public.payments;
create policy "payments: supprimer tant que non confirmé" on public.payments
  for delete to authenticated
  using (confirmed_at is null and (select auth.uid()) in (created_by, to_player));
