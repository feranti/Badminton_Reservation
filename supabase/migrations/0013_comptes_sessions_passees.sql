-- Les comptes ne tiennent compte que des sessions terminées : jusqu'à la fin d'une session, les
-- inscriptions, désinscriptions et annulations peuvent encore changer la part de chacun.
-- Une session compte dès que son heure de fin est passée (sessions.ends_at, la fin de son
-- dernier terrain). Les remboursements confirmés comptent tout de suite, comme avant.
-- Même vue que 0008, avec le filtre « s.ends_at <= now() » sur les sessions.
create or replace view public.balances
with (security_invoker = true)
as
with ended as (
  select s.id from public.sessions s
  where s.cancelled_at is null and s.ends_at <= now()
),
active as (
  select c.* from public.court_bookings c
  join ended s on s.id = c.session_id
  where c.cancelled_at is null
),
totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from active c where c.session_id = s.id), 0)::numeric as total_cents,
         (select coalesce(sum(p.spots), 0) from public.session_players p where p.session_id = s.id and p.is_playing) as players
  from ended s
),
shares as (
  select c.id, c.session_id, c.booked_by, c.co_payer, c.price_cents::numeric as price,
         case
           when c.co_payer is null then 0::numeric
           when c.card_pricing then
             round((case when c.co_payer_card then 450 else 500 end)
                   * (extract(epoch from c.ends_at - c.starts_at) / 60) / 60)
           else c.price_cents::numeric / 2
         end as co_cents
  from active c
),
advances as (
  select session_id, booked_by as player_id, price - co_cents as cents from shares
  union all
  select session_id, co_payer, co_cents from shares where co_payer is not null
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
  select from_player, amount_cents::numeric from public.payments where confirmed_at is not null and cancelled_at is null
  union all
  select to_player, -amount_cents::numeric from public.payments where confirmed_at is not null and cancelled_at is null
)
select pr.id as player_id,
       pr.display_name,
       round(coalesce(sum(m.cents), 0))::integer as balance_cents
from public.profiles pr
left join movements m on m.player_id = pr.id
group by pr.id, pr.display_name;
