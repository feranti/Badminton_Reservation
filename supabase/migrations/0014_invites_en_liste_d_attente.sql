-- Les invités prennent leur place dans la file un par un, et non plus en bloc avec leur joueur.
--
-- Avant, un joueur et ses invités jouaient ou attendaient ensemble : un joueur qui avait sa place
-- ne pouvait pas ajouter un invité dans une session complète (l'appli refusait), et un joueur qui
-- s'inscrivait avec des invités partait en liste d'attente avec eux s'il ne restait pas de place
-- pour tout le groupe.
-- Désormais, chaque place est classée à part : le joueur à l'heure de son inscription, chaque
-- invité à l'heure où il a été ajouté. Un joueur garde donc sa place, et un invité ajouté alors
-- que la session est pleine va en fin de liste d'attente, derrière ceux qui attendaient déjà.

-- ===========================================================================
-- Heure d'ajout de chaque invité
-- ===========================================================================
-- guests_added_at[i] = heure d'ajout du i-ème invité. Remplie par la base seulement : les joueurs
-- ne changent que le nombre d'invités (guests).
alter table public.session_participants
  add column guests_added_at timestamptz[] not null default '{}';

-- Invités déjà inscrits : ajoutés en même temps que leur joueur (comme avant).
update public.session_participants
set guests_added_at = array_fill(added_at, array[guests])
where guests > 0;

-- À l'inscription, les invités arrivent avec le joueur. Ensuite, un invité ajouté prend l'heure
-- de l'ajout ; un invité retiré est le dernier ajouté (celui qui attend le plus, s'il attend).
create function public.stamp_guests_added_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.guests_added_at := coalesce(array_fill(new.added_at, array[new.guests]), '{}');
  elsif new.guests > old.guests then
    new.guests_added_at := old.guests_added_at || array_fill(now(), array[new.guests - old.guests]);
  elsif new.guests < old.guests then
    new.guests_added_at := coalesce(old.guests_added_at[1:new.guests], '{}');
  else
    new.guests_added_at := old.guests_added_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_guests_added_at() from public, anon, authenticated;

create trigger stamp_guests_added_at before insert or update of guests on public.session_participants
  for each row execute function public.stamp_guests_added_at();

-- ===========================================================================
-- Vue des joueurs : une place par personne
-- ===========================================================================
-- Mêmes colonnes qu'avant, mais :
--   is_playing     : le joueur lui-même a sa place ;
--   spots          : places prises par le joueur et ses invités qui jouent (0 s'il attend) ;
-- et deux colonnes en plus :
--   guests_waiting : ses invités en liste d'attente (tous s'il attend lui-même) ;
--   waiting_rank   : rang de sa première place en liste d'attente (1 = le premier), vide sinon.
create or replace view public.session_players
with (security_invoker = true)
as
with capacity as (
  select s.id as session_id,
         4 * coalesce((
           select max(n)
           from (
             select count(distinct o.court) as n
             from public.court_bookings b
             join public.court_bookings o
               on o.session_id = b.session_id
              and o.cancelled_at is null
              and o.starts_at <= b.starts_at
              and o.ends_at > b.starts_at
             where b.session_id = s.id and b.cancelled_at is null
             group by b.id
           ) simultaneous
         ), 0) as capacity
  from public.sessions s
  where s.cancelled_at is null
),
active as (
  select p.session_id, p.player_id, p.added_at, p.guests, p.guests_added_at,
         row_number() over (partition by p.session_id order by p.added_at, p.player_id) as position
  from public.session_participants p
  where p.left_at is null
),
-- Le joueur (guest = 0), puis chacun de ses invités (guest = 1, 2…), chacun à son heure.
places as (
  select a.session_id, a.player_id, a.added_at, a.added_at as at, 0::bigint as guest
  from active a
  union all
  select a.session_id, a.player_id, a.added_at, g.at, g.n
  from active a
  cross join lateral unnest(a.guests_added_at) with ordinality as g(at, n)
),
ranked as (
  select pl.session_id, pl.player_id, pl.guest,
         row_number() over (partition by pl.session_id order by pl.at, pl.added_at, pl.player_id, pl.guest) as rank
  from places pl
),
counted as (
  select r.session_id, r.player_id,
         bool_or(r.guest = 0 and r.rank <= c.capacity) as is_playing,
         count(*) filter (where r.rank <= c.capacity)::integer as playing,
         count(*) filter (where r.guest > 0 and r.rank > c.capacity)::integer as guests_waiting,
         (min(r.rank) filter (where r.rank > c.capacity) - c.capacity)::integer as waiting_rank
  from ranked r
  join capacity c on c.session_id = r.session_id
  group by r.session_id, r.player_id, c.capacity
)
select a.session_id,
       a.player_id,
       a.added_at,
       a.position,
       n.is_playing,
       c.capacity,
       a.guests::integer as guests,
       n.playing as spots,
       n.guests_waiting,
       n.waiting_rank
from active a
join capacity c on c.session_id = a.session_id
join counted n on n.session_id = a.session_id and n.player_id = a.player_id;

-- ===========================================================================
-- Historique : invités en liste d'attente
-- ===========================================================================
create function public.session_player_guests_waiting(p_session uuid, p_player uuid)
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select guests_waiting from public.session_players where session_id = p_session and player_id = p_player;
$$;
revoke execute on function public.session_player_guests_waiting(uuid, uuid) from public, anon, authenticated;

-- Même fonction que 0008, avec le nombre d'invités en attente à l'inscription et au changement
-- d'invités (guests_waiting, absent s'il n'y en a pas).
create or replace function public.session_events_on_participant()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public.session_merge_target() is null then
      perform public.log_session_event(new.session_id, 'joined', new.player_id, jsonb_build_object(
        'guests', new.guests,
        'waiting', not public.session_player_is_playing(new.session_id, new.player_id),
        'guests_waiting', nullif(public.session_player_guests_waiting(new.session_id, new.player_id), 0)));
    end if;
    return null;
  end if;
  -- Désinscription : notée avant la mise à jour, pour savoir si le joueur était en liste d'attente.
  if new.left_at is not null and old.left_at is null then
    perform public.log_session_event(new.session_id, 'left', new.player_id, jsonb_build_object(
      'guests', old.guests,
      'waiting', not public.session_player_is_playing(old.session_id, old.player_id)));
  elsif tg_when = 'AFTER' and public.session_merge_target() is null and old.guests is distinct from new.guests then
    perform public.log_session_event(new.session_id, 'guests', new.player_id, jsonb_build_object(
      'from', old.guests, 'to', new.guests,
      'waiting', not public.session_player_is_playing(new.session_id, new.player_id),
      'guests_waiting', nullif(public.session_player_guests_waiting(new.session_id, new.player_id), 0)));
  end if;
  return new;
end;
$$;

-- L'appli note les passages liste d'attente ↔ joueurs, maintenant avec les invités : un joueur
-- qui passe avec n invités (details.guests), ou seulement n invités d'un joueur qui garde sa
-- place (details.invites). Les joueurs n'écrivent toujours pas details eux-mêmes : la fonction
-- n'accepte qu'un nombre d'invités.
create function public.log_waiting_change(p_session uuid, p_player uuid, p_kind text, p_guests integer, p_guests_only boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_kind not in ('promoted', 'demoted') or p_guests not between 0 and 10 then
    raise exception 'Passage de liste d''attente invalide';
  end if;
  perform public.log_session_event(p_session, p_kind, p_player, jsonb_build_object(
    'invites', case when p_guests_only and p_guests > 0 then p_guests end,
    'guests', case when not p_guests_only and p_guests > 0 then p_guests end));
end;
$$;
revoke execute on function public.log_waiting_change(uuid, uuid, text, integer, boolean) from public, anon;
grant execute on function public.log_waiting_change(uuid, uuid, text, integer, boolean) to authenticated;
