-- Badminton Résas : schéma initial
-- À exécuter dans Supabase (SQL Editor) ou avec `supabase db push`.
-- Les montants sont stockés en centimes (entiers) pour éviter les erreurs d'arrondi.

-- ---------------------------------------------------------------------------
-- Joueurs : un profil par compte Supabase
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Crée automatiquement le profil à la première connexion (nom = début de l'e-mail).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Réservations de terrain
-- ---------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  venue text not null,                       -- salle ou club
  court text,                                -- numéro ou nom du terrain
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents integer not null check (price_cents >= 0),
  booked_by uuid not null references public.profiles (id), -- qui a réservé et avancé l'argent
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index reservations_starts_at_idx on public.reservations (starts_at);

-- Joueurs présents sur une réservation : le prix est partagé à parts égales entre eux.
create table public.reservation_participants (
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  added_at timestamptz not null default now(),
  primary key (reservation_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Remboursements entre joueurs
-- Un remboursement compte dans les soldes une fois confirmé par celui qui le reçoit.
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  from_player uuid not null references public.profiles (id),
  to_player uuid not null references public.profiles (id),
  amount_cents integer not null check (amount_cents > 0),
  paid_on date not null default current_date,
  note text,
  confirmed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  check (from_player <> to_player)
);

-- ---------------------------------------------------------------------------
-- Solde de chaque joueur (positif = on lui doit de l'argent, négatif = il doit)
--   + ce qu'il a avancé pour les terrains
--   - sa part des terrains où il a joué
--   + les remboursements confirmés qu'il a envoyés
--   - les remboursements confirmés qu'il a reçus
-- ---------------------------------------------------------------------------
create view public.balances
with (security_invoker = true)
as
with shares as (
  select r.id as reservation_id,
         r.price_cents::numeric / count(p.player_id) as share_cents
  from public.reservations r
  join public.reservation_participants p on p.reservation_id = r.id
  group by r.id, r.price_cents
),
movements as (
  -- avancé pour un terrain (uniquement si au moins un participant)
  select r.booked_by as player_id, r.price_cents::numeric as cents
  from public.reservations r
  where exists (select 1 from public.reservation_participants p where p.reservation_id = r.id)
  union all
  -- part consommée
  select p.player_id, -s.share_cents
  from public.reservation_participants p
  join shares s on s.reservation_id = p.reservation_id
  union all
  select from_player, amount_cents::numeric from public.payments where confirmed_at is not null
  union all
  select to_player, -amount_cents::numeric from public.payments where confirmed_at is not null
)
select pr.id as player_id,
       pr.display_name,
       round(coalesce(sum(m.cents), 0))::integer as balance_cents
from public.profiles pr
left join movements m on m.player_id = pr.id
group by pr.id, pr.display_name;

-- ---------------------------------------------------------------------------
-- Sécurité (Row Level Security) : seuls les joueurs connectés voient et modifient les données.
-- L'accès au groupe se fait sur invitation (voir README).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_participants enable row level security;
alter table public.payments enable row level security;

create policy "profiles: lecture" on public.profiles
  for select to authenticated using (true);
create policy "profiles: modifier le sien" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "reservations: lecture" on public.reservations
  for select to authenticated using (true);
create policy "reservations: ajout" on public.reservations
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "reservations: modification" on public.reservations
  for update to authenticated using (true) with check (true);
create policy "reservations: suppression par le créateur ou le payeur" on public.reservations
  for delete to authenticated
  using (created_by = (select auth.uid()) or booked_by = (select auth.uid()));

create policy "participants: lecture" on public.reservation_participants
  for select to authenticated using (true);
create policy "participants: ajout" on public.reservation_participants
  for insert to authenticated with check (true);
create policy "participants: retrait" on public.reservation_participants
  for delete to authenticated using (true);

create policy "payments: lecture" on public.payments
  for select to authenticated using (true);
create policy "payments: déclarer (payeur ou bénéficiaire)" on public.payments
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and (select auth.uid()) in (from_player, to_player));
create policy "payments: confirmer (bénéficiaire)" on public.payments
  for update to authenticated
  using (to_player = (select auth.uid())) with check (to_player = (select auth.uid()));
-- Le bénéficiaire ne peut modifier que la date de confirmation.
revoke update on public.payments from authenticated;
grant update (confirmed_at) on public.payments to authenticated;

create policy "payments: supprimer tant que non confirmé" on public.payments
  for delete to authenticated
  using (created_by = (select auth.uid()) and confirmed_at is null);

-- ---------------------------------------------------------------------------
-- Temps réel : les changements sont diffusés aux joueurs connectés
-- ---------------------------------------------------------------------------
alter publication supabase_realtime
  add table public.reservations, public.reservation_participants, public.payments;
