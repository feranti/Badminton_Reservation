-- Capacité d'une session = 4 joueurs × le plus grand nombre de terrains réservés en même temps
-- (et non plus le nombre de terrains différents). Exemple : un terrain de 20:00 à 22:00, un
-- deuxième de 20:00 à 21:00 et un troisième de 21:00 à 22:00 font 2 terrains à la fois : 8 places.
-- Le maximum est atteint au début d'une réservation : on compte, au début de chacune,
-- les terrains occupés à cet instant.
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
              and o.starts_at <= b.starts_at
              and o.ends_at > b.starts_at
             where b.session_id = s.id
             group by b.id
           ) simultaneous
         ), 0) as capacity
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
