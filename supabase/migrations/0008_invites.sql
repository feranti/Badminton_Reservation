-- Badminton Résas : s'inscrire avec des invités extérieurs (+1, +2…).
--
-- Un inscrit peut venir avec des personnes qui n'ont pas de compte. Elles prennent une place
-- chacune et leur part est à la charge de l'inscrit qui les amène.
-- Un inscrit et ses invités jouent ensemble ou attendent ensemble : on parcourt les inscriptions
-- dans l'ordre d'arrivée et un groupe joue si toutes ses places tiennent dans la capacité.

alter table public.session_participants
  add column guests smallint not null default 0 check (guests between 0 and 10);

grant update (guests) on public.session_participants to authenticated;

create policy "participants: modification" on public.session_participants
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Joueurs effectifs et liste d'attente, en comptant les invités.
-- spots = places prises par l'inscrit et ses invités.
-- ---------------------------------------------------------------------------
create or replace view public.session_players
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

grant select on public.session_players to authenticated;

-- ---------------------------------------------------------------------------
-- Soldes : le prix est partagé par place ; l'inscrit paie aussi la part de ses invités.
-- ---------------------------------------------------------------------------
create or replace view public.balances
with (security_invoker = true)
as
with totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from public.court_bookings c where c.session_id = s.id), 0)::numeric as total_cents,
         (select coalesce(sum(p.spots), 0) from public.session_players p where p.session_id = s.id and p.is_playing) as players
  from public.sessions s
),
advances as (
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

-- ---------------------------------------------------------------------------
-- Fusion de sessions : les invités suivent leur inscrit.
-- ---------------------------------------------------------------------------
create or replace function public.add_court_booking(
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
