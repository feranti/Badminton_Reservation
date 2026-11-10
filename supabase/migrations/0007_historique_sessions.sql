-- Historique de chaque session : création, terrains réservés, modifiés ou annulés, inscriptions,
-- désinscriptions, invités, modifications et suppression.
--
-- Les événements sont écrits par des déclencheurs sur les tables : tout changement est enregistré,
-- quel que soit l'écran (ou l'appel) qui l'a fait. actor_id = le joueur connecté qui a fait
-- l'action (auth.uid()), player_id = le joueur concerné (inscrit, retiré, capitaine…).
-- Seuls les passages de la liste d'attente aux joueurs (et l'inverse) sont écrits par l'appli,
-- qui compare les joueurs avant et après chaque changement (src/lib/notify.ts).
--
-- Pas de clé étrangère vers sessions : l'historique d'une session supprimée est conservé.
create table public.session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  kind text not null check (kind in (
    'created', 'updated', 'deleted', 'merged',
    'booking_added', 'booking_updated', 'booking_removed',
    'joined', 'guests', 'left', 'promoted', 'demoted'
  )),
  actor_id uuid default auth.uid() references public.profiles (id) on delete set null,
  player_id uuid references public.profiles (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index session_events_session_idx on public.session_events (session_id, created_at desc, id desc);
create index session_events_actor_idx on public.session_events (actor_id);
create index session_events_player_idx on public.session_events (player_id);

alter table public.session_events enable row level security;

create policy "historique: lecture" on public.session_events
  for select to authenticated using (true);
-- L'appli n'écrit que les passages liste d'attente ↔ joueurs, en son nom ; le reste vient des déclencheurs.
create policy "historique: liste d'attente" on public.session_events
  for insert to authenticated
  with check (kind in ('promoted', 'demoted') and actor_id = (select auth.uid()));

grant select on public.session_events to authenticated;
grant insert (session_id, kind, player_id) on public.session_events to authenticated;

-- ===========================================================================
-- Écriture d'un événement (appelée seulement par les déclencheurs ci-dessous)
-- ===========================================================================
create function public.log_session_event(p_session uuid, p_kind text, p_player uuid, p_details jsonb)
returns void
language sql
security definer set search_path = ''
as $$
  insert into public.session_events (session_id, kind, actor_id, player_id, details)
  values (p_session, p_kind, auth.uid(), p_player, coalesce(jsonb_strip_nulls(p_details), '{}'::jsonb));
$$;

-- Session dans laquelle add_court_booking est en train d'en fusionner une autre (vide sinon).
-- Pendant une fusion, les joueurs et la session absorbée ne sont pas annoncés un par un.
create function public.session_merge_target()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.fusion_vers', true), '')::uuid;
$$;

-- Le joueur joue-t-il (true) ou est-il en liste d'attente (false) ?
create function public.session_player_is_playing(p_session uuid, p_player uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select is_playing from public.session_players where session_id = p_session and player_id = p_player;
$$;

-- ===========================================================================
-- Sessions
-- ===========================================================================
create function public.session_events_on_session()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_session_event(new.id, 'created', null, jsonb_build_object('venue', new.venue));
  elsif tg_op = 'UPDATE' then
    perform public.log_session_event(new.id, 'updated', null, jsonb_build_object(
      'venue', case when old.venue is distinct from new.venue then jsonb_build_object('from', old.venue, 'to', new.venue) end,
      'notes', case when old.notes is distinct from new.notes then jsonb_build_object('from', old.notes, 'to', new.notes) end
    ));
  elsif public.session_merge_target() is not null then
    -- Session absorbée par une autre : son historique y a déjà été déplacé.
    perform public.log_session_event(public.session_merge_target(), 'merged', null,
      jsonb_build_object('starts_at', old.starts_at, 'ends_at', old.ends_at));
    perform set_config('app.fusion_vers', '', true);
  else
    perform public.log_session_event(old.id, 'deleted', null,
      jsonb_build_object('venue', old.venue, 'starts_at', old.starts_at, 'ends_at', old.ends_at));
  end if;
  return null;
end;
$$;

create trigger session_events_insert after insert on public.sessions
  for each row execute function public.session_events_on_session();
create trigger session_events_update after update of venue, notes on public.sessions
  for each row when (old.venue is distinct from new.venue or old.notes is distinct from new.notes)
  execute function public.session_events_on_session();
create trigger session_events_delete after delete on public.sessions
  for each row execute function public.session_events_on_session();

-- ===========================================================================
-- Terrains
-- ===========================================================================
create function public.session_events_on_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_session_event(new.session_id, 'booking_added', new.booked_by, jsonb_build_object(
      'court', new.court, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
      'price_cents', new.price_cents, 'co_payer', new.co_payer));
  elsif tg_op = 'UPDATE' then
    if old.session_id is distinct from new.session_id then
      -- Fusion de deux sessions (add_court_booking) : l'historique suit les terrains, sauf la
      -- création de la session absorbée (remplacée par un événement « merged »).
      delete from public.session_events where session_id = old.session_id and kind = 'created';
      update public.session_events set session_id = new.session_id where session_id = old.session_id;
      perform set_config('app.fusion_vers', new.session_id::text, true);
    elsif old.price_cents is distinct from new.price_cents
       or old.booked_by is distinct from new.booked_by
       or old.co_payer is distinct from new.co_payer then
      perform public.log_session_event(new.session_id, 'booking_updated', new.booked_by, jsonb_build_object(
        'court', new.court, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
        'price', case when old.price_cents is distinct from new.price_cents
                      then jsonb_build_object('from', old.price_cents, 'to', new.price_cents) end,
        'payers', case when old.booked_by is distinct from new.booked_by or old.co_payer is distinct from new.co_payer
                       then jsonb_build_object('from', jsonb_build_array(old.booked_by, old.co_payer),
                                               'to', jsonb_build_array(new.booked_by, new.co_payer)) end));
    end if;
  -- Terrain retiré ; rien quand la session entière est supprimée (son retrait est déjà noté).
  elsif exists (select 1 from public.sessions where id = old.session_id) then
    perform public.log_session_event(old.session_id, 'booking_removed', old.booked_by, jsonb_build_object(
      'court', old.court, 'starts_at', old.starts_at, 'ends_at', old.ends_at, 'price_cents', old.price_cents));
  end if;
  return null;
end;
$$;

create trigger session_events_insert after insert on public.court_bookings
  for each row execute function public.session_events_on_booking();
create trigger session_events_update after update of session_id, price_cents, booked_by, co_payer on public.court_bookings
  for each row execute function public.session_events_on_booking();
create trigger session_events_delete after delete on public.court_bookings
  for each row execute function public.session_events_on_booking();

-- ===========================================================================
-- Inscriptions
-- ===========================================================================
create function public.session_events_on_participant()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.session_merge_target() is null then
      perform public.log_session_event(new.session_id, 'joined', new.player_id, jsonb_build_object(
        'guests', new.guests,
        'waiting', not public.session_player_is_playing(new.session_id, new.player_id)));
    end if;
    return null;
  elsif tg_op = 'UPDATE' then
    if public.session_merge_target() is null and old.guests is distinct from new.guests then
      perform public.log_session_event(new.session_id, 'guests', new.player_id, jsonb_build_object(
        'from', old.guests, 'to', new.guests,
        'waiting', not public.session_player_is_playing(new.session_id, new.player_id)));
    end if;
    return null;
  end if;
  -- Avant la suppression, pour savoir si le joueur était en liste d'attente. Rien quand la session
  -- entière est supprimée.
  if exists (select 1 from public.sessions where id = old.session_id) then
    perform public.log_session_event(old.session_id, 'left', old.player_id, jsonb_build_object(
      'guests', old.guests,
      'waiting', not public.session_player_is_playing(old.session_id, old.player_id)));
  end if;
  return old;
end;
$$;

create trigger session_events_insert after insert on public.session_participants
  for each row execute function public.session_events_on_participant();
create trigger session_events_update after update of guests on public.session_participants
  for each row execute function public.session_events_on_participant();
create trigger session_events_delete before delete on public.session_participants
  for each row execute function public.session_events_on_participant();

-- Fonctions internes : appelées seulement par les déclencheurs.
revoke execute on function public.log_session_event(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.session_merge_target() from public, anon, authenticated;
revoke execute on function public.session_player_is_playing(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.session_events_on_session() from public, anon, authenticated;
revoke execute on function public.session_events_on_booking() from public, anon, authenticated;
revoke execute on function public.session_events_on_participant() from public, anon, authenticated;

-- ===========================================================================
-- Reprise de l'existant : création, terrains et inscriptions encore présents, à leur date.
-- (Les désinscriptions et modifications d'avant ce script ne sont pas connues.)
-- ===========================================================================
insert into public.session_events (session_id, kind, actor_id, player_id, details, created_at)
select id, 'created', created_by, null, jsonb_build_object('venue', venue, 'repris', true), created_at
from public.sessions
order by created_at;

insert into public.session_events (session_id, kind, actor_id, player_id, details, created_at)
select session_id, 'booking_added', created_by, booked_by,
       jsonb_strip_nulls(jsonb_build_object('court', court, 'starts_at', starts_at, 'ends_at', ends_at,
                                            'price_cents', price_cents, 'co_payer', co_payer, 'repris', true)),
       created_at
from public.court_bookings
order by created_at;

insert into public.session_events (session_id, kind, actor_id, player_id, details, created_at)
select session_id, 'joined', null, player_id, jsonb_build_object('guests', guests, 'repris', true), added_at
from public.session_participants
order by added_at;
