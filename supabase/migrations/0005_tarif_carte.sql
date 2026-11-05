-- Tarif « carte 10 sessions » du Prisme (Bobigny).
-- Avec la carte, chaque réservant paie 4,50 € l'heure ; sans carte, 5 € l'heure. Un terrain doit
-- avoir deux réservants : si le capitaine (booked_by) est seul, il paie en plus 5 € l'heure pour
-- le partenaire absent. Seul avec carte : 9,50 €/h ; à deux avec carte : 9 €/h.
-- Le prix (price_cents) est calculé par l'appli (src/lib/courts.ts) et enregistré comme avant ;
-- ces colonnes servent à le recalculer quand le second réservant change, et à créditer chacun
-- de sa part exacte dans les comptes.
alter table public.court_bookings
  add column card_pricing boolean not null default false,   -- prix calculé avec le tarif carte
  add column booked_by_card boolean not null default false, -- le capitaine a payé avec sa carte
  add column co_payer_card boolean not null default false;  -- le second réservant aussi

-- Ajout d'une réservation : mêmes étapes qu'avant, avec le tarif carte en plus.
drop function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid);

create function public.add_court_booking(
  p_venue text,
  p_court smallint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_price_cents integer,
  p_booked_by uuid,
  p_co_payer uuid default null,
  p_card_pricing boolean default false,
  p_booked_by_card boolean default false,
  p_co_payer_card boolean default false
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
    (session_id, court, starts_at, ends_at, price_cents, booked_by, co_payer, created_by,
     card_pricing, booked_by_card, co_payer_card)
  values (v_target, p_court, p_starts_at, p_ends_at, p_price_cents, p_booked_by, p_co_payer, v_user,
          p_card_pricing, p_booked_by_card, p_co_payer is not null and p_co_payer_card);

  perform public.refresh_session_slot(v_target);
  return v_target;
end;
$$;

revoke execute on function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid, boolean, boolean, boolean) to authenticated;

-- Soldes : au tarif carte, le second réservant est crédité de sa part (4,50 € ou 5 € l'heure)
-- et le capitaine du reste (sa part, plus le supplément s'il est seul). Sinon, comme avant :
-- moitié chacun à deux payeurs. Le reste de la vue est inchangé.
create or replace view public.balances
with (security_invoker = true)
as
with totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from public.court_bookings c where c.session_id = s.id), 0)::numeric as total_cents,
         (select coalesce(sum(p.spots), 0) from public.session_players p where p.session_id = s.id and p.is_playing) as players
  from public.sessions s
),
shares as (
  -- part avancée par le second payeur (0 s'il n'y en a pas)
  select c.id, c.session_id, c.booked_by, c.co_payer, c.price_cents::numeric as price,
         case
           when c.co_payer is null then 0::numeric
           when c.card_pricing then
             round((case when c.co_payer_card then 450 else 500 end)
                   * (extract(epoch from c.ends_at - c.starts_at) / 60) / 60)
           else c.price_cents::numeric / 2
         end as co_cents
  from public.court_bookings c
),
advances as (
  -- ce que chaque payeur a avancé pour un terrain
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
