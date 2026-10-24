-- Badminton Résas : plusieurs terrains par soirée
-- Une soirée (session) regroupe un ou plusieurs terrains, chacun réservé et payé par un joueur.
-- Les joueurs s'inscrivent à la soirée ; le prix total des terrains est partagé à parts égales entre eux.
-- Remplace les tables reservations et reservation_participants de 0001 (encore vides).

drop view if exists public.balances;
drop table if exists public.reservation_participants;
drop table if exists public.reservations;

-- ---------------------------------------------------------------------------
-- Soirées
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  venue text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index sessions_starts_at_idx on public.sessions (starts_at);

-- Terrains réservés pour une soirée
create table public.court_bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  court smallint not null check (court > 0),
  price_cents integer not null check (price_cents >= 0),
  booked_by uuid not null references public.profiles (id), -- qui a réservé et avancé l'argent
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (session_id, court)
);

-- Joueurs présents à la soirée
create table public.session_participants (
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  added_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Solde de chaque joueur (positif = on lui doit de l'argent, négatif = il doit)
--   + ce qu'il a avancé pour les terrains (soirées avec au moins un joueur inscrit)
--   - sa part du total de chaque soirée où il a joué
--   + les remboursements confirmés qu'il a envoyés
--   - les remboursements confirmés qu'il a reçus
-- ---------------------------------------------------------------------------
create view public.balances
with (security_invoker = true)
as
with totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from public.court_bookings c where c.session_id = s.id), 0)::numeric as total_cents,
         (select count(*) from public.session_participants p where p.session_id = s.id) as players
  from public.sessions s
),
movements as (
  select c.booked_by as player_id, c.price_cents::numeric as cents
  from public.court_bookings c
  join totals t on t.session_id = c.session_id
  where t.players > 0
  union all
  select p.player_id, -(t.total_cents / t.players)
  from public.session_participants p
  join totals t on t.session_id = p.session_id
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
-- Sécurité
-- ---------------------------------------------------------------------------
alter table public.sessions enable row level security;
alter table public.court_bookings enable row level security;
alter table public.session_participants enable row level security;

create policy "sessions: lecture" on public.sessions
  for select to authenticated using (true);
create policy "sessions: ajout" on public.sessions
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "sessions: modification" on public.sessions
  for update to authenticated using (true) with check (true);
create policy "sessions: suppression par le créateur" on public.sessions
  for delete to authenticated using (created_by = (select auth.uid()));

create policy "terrains: lecture" on public.court_bookings
  for select to authenticated using (true);
create policy "terrains: ajout" on public.court_bookings
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy "terrains: modification" on public.court_bookings
  for update to authenticated using (true) with check (true);
create policy "terrains: suppression" on public.court_bookings
  for delete to authenticated using (true);

create policy "participants: lecture" on public.session_participants
  for select to authenticated using (true);
create policy "participants: ajout" on public.session_participants
  for insert to authenticated with check (true);
create policy "participants: retrait" on public.session_participants
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Temps réel
-- ---------------------------------------------------------------------------
alter publication supabase_realtime
  add table public.sessions, public.court_bookings, public.session_participants;
