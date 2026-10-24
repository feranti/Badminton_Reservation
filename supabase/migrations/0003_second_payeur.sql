-- Badminton Résas : un terrain peut être payé par deux personnes (comme sur le site du gymnase).
-- Avec un second payeur, chacun avance la moitié du prix du terrain.

alter table public.court_bookings
  add column co_payer uuid references public.profiles (id),
  add constraint court_bookings_co_payer_differs check (co_payer is null or co_payer <> booked_by);

create or replace view public.balances
with (security_invoker = true)
as
with totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from public.court_bookings c where c.session_id = s.id), 0)::numeric as total_cents,
         (select count(*) from public.session_participants p where p.session_id = s.id) as players
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
