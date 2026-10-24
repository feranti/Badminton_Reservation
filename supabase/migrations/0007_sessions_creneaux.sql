-- Badminton Résas : réservations sur leur propre créneau, sessions automatiques,
-- capacité de 4 joueurs par terrain et liste d'attente, QR codes.
--
-- Une réservation (court_bookings) = un terrain sur un créneau, telle qu'achetée sur le site du gymnase.
-- Une session (sessions) regroupe les réservations d'un même lieu dont les créneaux se touchent
-- ou se chevauchent. Ses heures de début et de fin suivent celles de ses réservations.

-- ---------------------------------------------------------------------------
-- Créneau propre à chaque réservation, et QR code
-- ---------------------------------------------------------------------------
alter table public.court_bookings
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column qr_path text;

update public.court_bookings c
set starts_at = s.starts_at, ends_at = s.ends_at
from public.sessions s
where s.id = c.session_id;

alter table public.court_bookings
  alter column starts_at set not null,
  alter column ends_at set not null,
  add constraint court_bookings_slot_check check (ends_at > starts_at),
  drop constraint court_bookings_session_id_court_key,
  add constraint court_bookings_session_court_slot_key unique (session_id, court, starts_at);

grant update (qr_path) on public.court_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Ajout d'une réservation : rattachée à la session contiguë, ou nouvelle session.
-- Si le créneau relie deux sessions, elles fusionnent (joueurs gardés dans l'ordre d'inscription).
-- ---------------------------------------------------------------------------
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
      insert into public.session_participants (session_id, player_id, added_at)
        select v_target, player_id, added_at from public.session_participants where session_id = v_other
        on conflict (session_id, player_id) do update
          set added_at = least(public.session_participants.added_at, excluded.added_at);
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

revoke execute on function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid) from public, anon;
revoke execute on function public.remove_court_booking(uuid) from public, anon;
revoke execute on function public.refresh_session_slot(uuid) from public, anon, authenticated;
grant execute on function public.add_court_booking(text, smallint, timestamptz, timestamptz, integer, uuid, uuid) to authenticated;
grant execute on function public.remove_court_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Joueurs effectifs et liste d'attente
-- Capacité d'une session = 4 joueurs × nombre de terrains différents.
-- Les premiers inscrits jouent, les suivants sont en liste d'attente.
-- ---------------------------------------------------------------------------
create view public.session_players
with (security_invoker = true)
as
with capacity as (
  select s.id as session_id,
         4 * (select count(distinct c.court) from public.court_bookings c where c.session_id = s.id) as capacity
  from public.sessions s
)
select p.session_id,
       p.player_id,
       p.added_at,
       row_number() over (partition by p.session_id order by p.added_at, p.player_id) as position,
       row_number() over (partition by p.session_id order by p.added_at, p.player_id) <= c.capacity as is_playing,
       c.capacity
from public.session_participants p
join capacity c on c.session_id = p.session_id;

grant select on public.session_players to authenticated;

-- ---------------------------------------------------------------------------
-- Soldes : seuls les joueurs effectifs partagent le prix des terrains
-- ---------------------------------------------------------------------------
create or replace view public.balances
with (security_invoker = true)
as
with totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from public.court_bookings c where c.session_id = s.id), 0)::numeric as total_cents,
         (select count(*) from public.session_players p where p.session_id = s.id and p.is_playing) as players
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
  select p.player_id, -(t.total_cents / t.players)
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
-- QR codes : stockage privé, lisible et modifiable par les joueurs connectés
-- ---------------------------------------------------------------------------
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
