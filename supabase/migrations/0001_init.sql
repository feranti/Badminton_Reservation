-- Badminton Résas : création complète de la base, en une seule fois.
--
-- À exécuter une fois dans Supabase > SQL Editor sur un projet neuf (ou appliqué
-- automatiquement par `npx supabase start` / `supabase db reset` en local).
-- Regroupe les anciennes migrations 0001 à 0009 : la base obtenue est identique à celle
-- du projet en ligne, qui n'a donc rien à exécuter.
--
-- Les montants sont stockés en centimes (entiers) pour éviter les erreurs d'arrondi.
-- Les données de test sont à part : supabase/donnees-test/.

-- ===========================================================================
-- Joueurs : un profil par compte Supabase
-- ===========================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 40)
);

-- Crée automatiquement le profil à la création du compte (nom = début de l'e-mail).
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

-- ===========================================================================
-- Sessions : regroupent les réservations d'un même lieu dont les créneaux
-- se touchent ou se chevauchent. Leurs heures suivent celles des réservations.
-- ===========================================================================
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  venue text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint sessions_venue_length check (char_length(venue) between 1 and 100),
  constraint sessions_notes_length check (notes is null or char_length(notes) <= 500)
);

create index sessions_starts_at_idx on public.sessions (starts_at);

-- ===========================================================================
-- Réservations : un terrain sur un créneau, telle qu'achetée sur le site du gymnase.
-- Payée par un joueur, ou par deux (chacun avance alors la moitié du prix).
-- ===========================================================================
create table public.court_bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  court smallint not null check (court > 0),
  price_cents integer not null check (price_cents >= 0),
  booked_by uuid not null references public.profiles (id), -- qui a réservé et avancé l'argent
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  co_payer uuid references public.profiles (id),           -- second payeur éventuel
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  qr_path text,                                             -- QR code dans le stockage « qr-codes »
  constraint court_bookings_co_payer_differs check (co_payer is null or co_payer <> booked_by),
  constraint court_bookings_slot_check check (ends_at > starts_at),
  constraint court_bookings_session_court_slot_key unique (session_id, court, starts_at),
  constraint court_bookings_price_max check (price_cents <= 100000),
  constraint court_bookings_qr_path_length check (qr_path is null or char_length(qr_path) <= 300)
);

-- ===========================================================================
-- Inscriptions à une session, avec d'éventuels invités sans compte (+1, +2…).
-- Chaque invité prend une place ; sa part est à la charge de l'inscrit qui l'amène.
-- ===========================================================================
create table public.session_participants (
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.profiles (id),
  added_at timestamptz not null default now(),
  guests smallint not null default 0 check (guests between 0 and 10),
  primary key (session_id, player_id)
);

-- ===========================================================================
-- Remboursements entre joueurs.
-- Un remboursement compte dans les soldes une fois confirmé par celui qui le reçoit.
-- ===========================================================================
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
  check (from_player <> to_player),
  constraint payments_amount_max check (amount_cents <= 1000000),
  constraint payments_note_length check (note is null or char_length(note) <= 200)
);

create index payments_created_at_idx on public.payments (created_at desc);

-- ===========================================================================
-- Joueurs effectifs et liste d'attente.
-- Capacité d'une session = 4 joueurs × nombre de terrains différents.
-- On parcourt les inscriptions dans l'ordre d'arrivée : un inscrit et ses invités jouent
-- ensemble si toutes leurs places tiennent dans la capacité, sinon ils attendent ensemble.
-- spots = places prises par l'inscrit et ses invités.
-- ===========================================================================
create view public.session_players
with (security_invoker = true)
as
with capacity as (
  select s.id as session_id,
         4 * (select count(distinct c.court) from public.court_bookings c where c.session_id = s.id) as capacity
  from public.sessions s
),
ordered as (
  select p.session_id,
         p.player_id,
         p.added_at,
         p.guests,
         row_number() over w as position,
         sum(1 + p.guests) over (w rows between unbounded preceding and current row) as used
  from public.session_participants p
  window w as (partition by p.session_id order by p.added_at, p.player_id)
)
select o.session_id,
       o.player_id,
       o.added_at,
       o.position,
       o.used <= c.capacity as is_playing,
       c.capacity,
       o.guests::integer as guests,
       1 + o.guests::integer as spots
from ordered o
join capacity c on c.session_id = o.session_id;

-- ===========================================================================
-- Solde de chaque joueur (positif = on lui doit de l'argent, négatif = il doit)
--   + ce qu'il a avancé pour les terrains (sessions avec au moins un joueur effectif)
--   - sa part du total de chaque session où il a joué (une part par place, invités compris)
--   + les remboursements confirmés qu'il a envoyés
--   - les remboursements confirmés qu'il a reçus
-- ===========================================================================
create view public.balances
with (security_invoker = true)
as
with totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from public.court_bookings c where c.session_id = s.id), 0)::numeric as total_cents,
         (select coalesce(sum(p.spots), 0) from public.session_players p where p.session_id = s.id and p.is_playing) as players
  from public.sessions s
),
advances as (
  -- ce que chaque payeur a avancé pour un terrain
  select c.session_id, c.booked_by as player_id,
         case when c.co_payer is null then c.price_cents::numeric else c.price_cents::numeric / 2 end as cents
  from public.court_bookings c
  union all
  select c.session_id, c.co_payer, c.price_cents::numeric / 2
  from public.court_bookings c
  where c.co_payer is not null
),
movements as (
  select a.player_id, a.cents
  from advances a
  join totals t on t.session_id = a.session_id
  where t.players > 0
  union all
  select p.player_id, -(t.total_cents * p.spots / t.players)
  from public.session_players p
  join totals t on t.session_id = p.session_id
  where p.is_playing
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

-- ===========================================================================
-- Ajout et retrait d'une réservation
-- ===========================================================================

-- Recalcule le début et la fin d'une session à partir de ses réservations.
-- Une session sans réservation est supprimée (avec ses inscriptions).
create function public.refresh_session_slot(p_session uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  select min(starts_at), max(ends_at) into v_start, v_end
  from public.court_bookings where session_id = p_session;

  if v_start is null then
    delete from public.sessions where id = p_session;
  else
    update public.sessions set starts_at = v_start, ends_at = v_end where id = p_session;
  end if;
end;
$$;

-- Ajout : la réservation est rattachée à la session contiguë, ou crée une nouvelle session.
-- Si le créneau relie deux sessions, elles fusionnent (joueurs gardés dans l'ordre
-- d'inscription, invités compris).
create function public.add_court_booking(
  p_venue text,
  p_court smallint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_price_cents integer,
  p_booked_by uuid,
  p_co_payer uuid default null
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_target uuid;
  v_other uuid;
begin
  if v_user is null then
    raise exception 'Connexion requise';
  end if;

  -- Sessions du même lieu dont le créneau touche ou chevauche le nouveau
  select id into v_target
  from public.sessions
  where venue = p_venue and starts_at <= p_ends_at and ends_at >= p_starts_at
  order by created_at
  limit 1;

  if v_target is null then
    insert into public.sessions (venue, starts_at, ends_at, created_by)
    values (p_venue, p_starts_at, p_ends_at, v_user)
    returning id into v_target;
  else
    for v_other in
      select id from public.sessions
      where id <> v_target and venue = p_venue and starts_at <= p_ends_at and ends_at >= p_starts_at
    loop
      update public.court_bookings set session_id = v_target where session_id = v_other;
      insert into public.session_participants (session_id, player_id, added_at, guests)
        select v_target, player_id, added_at, guests from public.session_participants where session_id = v_other
        on conflict (session_id, player_id) do update
          set added_at = least(public.session_participants.added_at, excluded.added_at),
              guests = greatest(public.session_participants.guests, excluded.guests);
      delete from public.sessions where id = v_other;
    end loop;
  end if;

  insert into public.court_bookings
    (session_id, court, starts_at, ends_at, price_cents, booked_by, co_payer, created_by)
  values (v_target, p_court, p_starts_at, p_ends_at, p_price_cents, p_booked_by, p_co_payer, v_user);

  perform public.refresh_session_slot(v_target);
  return v_target;
end;
$$;

create function public.remove_court_booking(p_booking uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_session uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  delete from public.court_bookings where id = p_booking returning session_id into v_session;
  if v_session is not null then
    perform public.refresh_session_slot(v_session);
  end if;
end;
$$;

-- ===========================================================================
-- Règles d'accès (RLS) : seuls les joueurs connectés voient et modifient les données.
-- L'accès au groupe se fait sur invitation (voir README).
-- ===========================================================================
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.court_bookings enable row level security;
alter table public.session_participants enable row level security;
alter table public.payments enable row level security;

create policy "profiles: lecture" on public.profiles
  for select to authenticated using (true);
create policy "profiles: modifier le sien" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

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
create policy "participants: modification" on public.session_participants
  for update to authenticated using (true) with check (true);
create policy "participants: retrait" on public.session_participants
  for delete to authenticated using (true);

create policy "payments: lecture" on public.payments
  for select to authenticated using (true);
-- Un remboursement ne peut être déclaré déjà confirmé que par celui qui le reçoit.
create policy "payments: déclarer (payeur ou bénéficiaire)" on public.payments
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select auth.uid()) in (from_player, to_player)
    and (confirmed_at is null or to_player = (select auth.uid()))
  );
create policy "payments: confirmer (bénéficiaire)" on public.payments
  for update to authenticated
  using (to_player = (select auth.uid())) with check (to_player = (select auth.uid()));
-- Un remboursement en attente peut être annulé par celui qui l'a déclaré
-- ou refusé par celui qui devait le recevoir.
create policy "payments: supprimer tant que non confirmé" on public.payments
  for delete to authenticated
  using (confirmed_at is null and (select auth.uid()) in (created_by, to_player));

-- ===========================================================================
-- Droits de l'API : uniquement ceux dont l'appli se sert, pour les joueurs connectés.
-- Selon les réglages du projet, Supabase ouvre ou non les nouvelles tables à l'API
-- (avec TRUNCATE, qui ignore les règles RLS) : on part de zéro pour avoir le même
-- résultat partout, puis on donne les droits un par un. Les règles RLS s'appliquent en plus.
-- ===========================================================================
revoke all on all tables in schema public from anon, authenticated;
-- Même chose pour les tables créées plus tard.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.balances, public.session_players to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.sessions, public.court_bookings to authenticated;
grant select, insert, delete on public.session_participants to authenticated;
grant update (guests) on public.session_participants to authenticated;
grant select, insert, delete on public.payments to authenticated;
grant update (confirmed_at) on public.payments to authenticated; -- seul le bénéficiaire, via RLS

-- Fonctions : la création de profil n'est appelée que par le déclencheur, et le recalcul
-- d'une session que par les deux fonctions d'ajout et de retrait.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.refresh_session_slot(uuid) from public, anon, authenticated;
revoke execute on function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid) from public, anon;
revoke execute on function public.remove_court_booking(uuid) from public, anon;
grant execute on function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid) to authenticated;
grant execute on function public.remove_court_booking(uuid) to authenticated;

-- ===========================================================================
-- QR codes : stockage privé, lisible et modifiable par les joueurs connectés
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qr-codes', 'qr-codes', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy "qr-codes: lecture" on storage.objects
  for select to authenticated using (bucket_id = 'qr-codes');
create policy "qr-codes: envoi" on storage.objects
  for insert to authenticated with check (bucket_id = 'qr-codes');
create policy "qr-codes: remplacement" on storage.objects
  for update to authenticated using (bucket_id = 'qr-codes') with check (bucket_id = 'qr-codes');
create policy "qr-codes: suppression" on storage.objects
  for delete to authenticated using (bucket_id = 'qr-codes');

-- ===========================================================================
-- Temps réel : les changements sont diffusés aux joueurs connectés
-- ===========================================================================
alter publication supabase_realtime
  add table public.sessions, public.court_bookings, public.session_participants, public.payments;
