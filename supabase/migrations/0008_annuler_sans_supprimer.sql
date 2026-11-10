-- On ne supprime plus rien en base : une session, un terrain, une inscription, un QR code ou un
-- remboursement annulé reste en base, marqué comme annulé (quand et par qui).
--   sessions             cancelled_at, cancelled_by, merged_into (session qui l'a absorbée)
--   court_bookings       cancelled_at, cancelled_by
--   session_participants left_at, left_by        (un joueur qui revient a une nouvelle ligne)
--   booking_qr_codes     removed_at, removed_by   (un QR code remis efface removed_at)
--   payments             cancelled_at, cancelled_by
-- « par qui » est rempli par la base (auth.uid()) au moment de l'annulation.
-- Le droit DELETE est retiré aux joueurs sur toutes ces tables : la règle tient même en cas
-- d'appel direct à l'API.

-- ===========================================================================
-- Colonnes
-- ===========================================================================
alter table public.sessions
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id),
  add column merged_into uuid references public.sessions (id);

alter table public.court_bookings
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id);

alter table public.booking_qr_codes
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles (id);

alter table public.payments
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id);

-- Inscriptions : plusieurs lignes possibles par joueur (inscrit, désinscrit, réinscrit…), une seule active.
alter table public.session_participants
  add column id uuid not null default gen_random_uuid(),
  add column left_at timestamptz,
  add column left_by uuid references public.profiles (id);
alter table public.session_participants drop constraint session_participants_pkey;
alter table public.session_participants add primary key (id);
create unique index session_participants_active_key on public.session_participants (session_id, player_id) where left_at is null;
create index session_participants_session_idx on public.session_participants (session_id);

-- Un terrain annulé libère son créneau.
alter table public.court_bookings drop constraint court_bookings_session_court_slot_key;
create unique index court_bookings_active_slot_key on public.court_bookings (session_id, court, starts_at) where cancelled_at is null;

create index sessions_cancelled_by_idx on public.sessions (cancelled_by);
create index sessions_merged_into_idx on public.sessions (merged_into);
create index court_bookings_cancelled_by_idx on public.court_bookings (cancelled_by);
create index booking_qr_codes_removed_by_idx on public.booking_qr_codes (removed_by);
create index payments_cancelled_by_idx on public.payments (cancelled_by);
create index session_participants_left_by_idx on public.session_participants (left_by);

-- ===========================================================================
-- « Par qui » : rempli au moment de l'annulation, effacé si la ligne est rétablie (QR code remis).
-- ===========================================================================
create function public.stamp_cancellation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_at text := tg_argv[0];
  v_by text := tg_argv[1];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  if v_new ->> v_at is not null and v_old ->> v_at is null then
    v_new := jsonb_set(v_new, array[v_by], to_jsonb(auth.uid()));
  elsif v_new ->> v_at is null then
    v_new := jsonb_set(v_new, array[v_by], 'null'::jsonb);
  end if;
  return jsonb_populate_record(new, v_new);
end;
$$;

create trigger stamp_cancellation before update of cancelled_at on public.sessions
  for each row execute function public.stamp_cancellation('cancelled_at', 'cancelled_by');
create trigger stamp_cancellation before update of cancelled_at on public.court_bookings
  for each row execute function public.stamp_cancellation('cancelled_at', 'cancelled_by');
create trigger stamp_cancellation before update of removed_at on public.booking_qr_codes
  for each row execute function public.stamp_cancellation('removed_at', 'removed_by');
create trigger stamp_cancellation before update of cancelled_at on public.payments
  for each row execute function public.stamp_cancellation('cancelled_at', 'cancelled_by');
create trigger stamp_cancellation before update of left_at on public.session_participants
  for each row execute function public.stamp_cancellation('left_at', 'left_by');

-- ===========================================================================
-- Plus de suppression pour les joueurs
-- ===========================================================================
drop policy "sessions: suppression par le créateur" on public.sessions;
drop policy "terrains: suppression" on public.court_bookings;
drop policy "participants: retrait" on public.session_participants;
drop policy "qr: suppression" on public.booking_qr_codes;
drop policy "payments: supprimer tant que non confirmé" on public.payments;

revoke delete on public.sessions, public.court_bookings, public.session_participants,
  public.booking_qr_codes, public.payments from anon, authenticated;

-- Annuler une session : réservé à son créateur, comme la suppression avant.
create policy "sessions: annulation par le créateur" on public.sessions
  as restrictive for update to authenticated
  using (true)
  with check (cancelled_at is null or created_by = (select auth.uid()));

-- Inscriptions : on peut changer ses invités (déjà permis) et marquer l'inscription comme quittée.
grant update (left_at) on public.session_participants to authenticated;

-- Remboursements : annuler (celui qui l'a déclaré) ou refuser (le bénéficiaire) tant qu'il n'est
-- pas confirmé. Par une fonction, pour ne pas ouvrir la mise à jour de confirmed_at à l'auteur.
create function public.cancel_payment(p_payment uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.payments set cancelled_at = now()
  where id = p_payment and confirmed_at is null and cancelled_at is null
    and (select auth.uid()) in (created_by, to_player);
$$;
revoke execute on function public.cancel_payment(uuid) from public, anon;
grant execute on function public.cancel_payment(uuid) to authenticated;

-- Un remboursement annulé ne peut plus être confirmé.
drop policy "payments: confirmer (bénéficiaire)" on public.payments;
create policy "payments: confirmer (bénéficiaire)" on public.payments
  for update to authenticated
  using (to_player = (select auth.uid()) and cancelled_at is null)
  with check (to_player = (select auth.uid()));

-- Inscrit des joueurs (s'ils ne le sont pas déjà) et renvoie ceux qui viennent d'être ajoutés.
-- Remplace l'« upsert » de l'appli, impossible sur un index unique partiel.
create function public.add_participants(p_session uuid, p_players uuid[], p_guests smallint default 0)
returns setof uuid
language sql
set search_path = ''
as $$
  insert into public.session_participants (session_id, player_id, guests)
  select p_session, p, p_guests from unnest(p_players) as p
  on conflict (session_id, player_id) where left_at is null do nothing
  returning player_id;
$$;
revoke execute on function public.add_participants(uuid, uuid[], smallint) from public, anon;
grant execute on function public.add_participants(uuid, uuid[], smallint) to authenticated;

-- ===========================================================================
-- Vues : seules les lignes actives comptent
-- ===========================================================================
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
ordered as (
  select p.session_id,
         p.player_id,
         p.added_at,
         p.guests,
         row_number() over w as position,
         sum(1 + p.guests) over (w rows between unbounded preceding and current row) as used
  from public.session_participants p
  where p.left_at is null
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

create or replace view public.balances
with (security_invoker = true)
as
with active as (
  select c.* from public.court_bookings c
  join public.sessions s on s.id = c.session_id and s.cancelled_at is null
  where c.cancelled_at is null
),
totals as (
  select s.id as session_id,
         coalesce((select sum(c.price_cents) from active c where c.session_id = s.id), 0)::numeric as total_cents,
         (select coalesce(sum(p.spots), 0) from public.session_players p where p.session_id = s.id and p.is_playing) as players
  from public.sessions s
  where s.cancelled_at is null
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

-- ===========================================================================
-- Ajout et retrait d'une réservation : les sessions et terrains sont annulés, pas supprimés
-- ===========================================================================
create or replace function public.refresh_session_slot(p_session uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  select min(starts_at), max(ends_at) into v_start, v_end
  from public.court_bookings where session_id = p_session and cancelled_at is null;

  if v_start is null then
    update public.sessions set cancelled_at = now() where id = p_session and cancelled_at is null;
  else
    update public.sessions set starts_at = v_start, ends_at = v_end where id = p_session;
  end if;
end;
$$;

create or replace function public.remove_court_booking(p_booking uuid)
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
  update public.court_bookings set cancelled_at = now()
  where id = p_booking and cancelled_at is null
  returning session_id into v_session;
  if v_session is not null then
    perform public.refresh_session_slot(v_session);
  end if;
end;
$$;

create or replace function public.add_court_booking(
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

  -- Sessions actives du même lieu dont le créneau touche ou chevauche le nouveau
  select id into v_target
  from public.sessions
  where cancelled_at is null and venue = p_venue and starts_at <= p_ends_at and ends_at >= p_starts_at
  order by created_at
  limit 1;

  if v_target is null then
    insert into public.sessions (venue, starts_at, ends_at, created_by)
    values (p_venue, p_starts_at, p_ends_at, v_user)
    returning id into v_target;
  else
    -- Fusion : les terrains et les inscrits rejoignent la première session, l'autre est
    -- marquée comme absorbée (merged_into).
    for v_other in
      select id from public.sessions
      where cancelled_at is null and id <> v_target and venue = p_venue and starts_at <= p_ends_at and ends_at >= p_starts_at
    loop
      update public.court_bookings set session_id = v_target where session_id = v_other;
      insert into public.session_participants (session_id, player_id, added_at, guests)
        select v_target, player_id, added_at, guests from public.session_participants
        where session_id = v_other and left_at is null
        on conflict (session_id, player_id) where left_at is null do update
          set added_at = least(public.session_participants.added_at, excluded.added_at),
              guests = greatest(public.session_participants.guests, excluded.guests);
      update public.sessions set cancelled_at = now(), merged_into = v_target where id = v_other;
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

-- ===========================================================================
-- Historique (0007) : les annulations remplacent les suppressions
-- ===========================================================================
create or replace function public.session_events_on_session()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_session_event(new.id, 'created', null, jsonb_build_object('venue', new.venue));
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    if new.merged_into is not null then
      -- Session absorbée par une autre : son historique y a déjà été déplacé.
      perform public.log_session_event(new.merged_into, 'merged', null,
        jsonb_build_object('starts_at', old.starts_at, 'ends_at', old.ends_at));
      perform set_config('app.fusion_vers', '', true);
    else
      perform public.log_session_event(new.id, 'deleted', null,
        jsonb_build_object('venue', old.venue, 'starts_at', old.starts_at, 'ends_at', old.ends_at));
    end if;
  elsif old.venue is distinct from new.venue or old.notes is distinct from new.notes then
    perform public.log_session_event(new.id, 'updated', null, jsonb_build_object(
      'venue', case when old.venue is distinct from new.venue then jsonb_build_object('from', old.venue, 'to', new.venue) end,
      'notes', case when old.notes is distinct from new.notes then jsonb_build_object('from', old.notes, 'to', new.notes) end
    ));
  end if;
  return null;
end;
$$;

drop trigger session_events_update on public.sessions;
drop trigger session_events_delete on public.sessions;
create trigger session_events_update after update of venue, notes, cancelled_at on public.sessions
  for each row execute function public.session_events_on_session();

create or replace function public.session_events_on_booking()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_session_event(new.session_id, 'booking_added', new.booked_by, jsonb_build_object(
      'court', new.court, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
      'price_cents', new.price_cents, 'co_payer', new.co_payer));
  elsif old.session_id is distinct from new.session_id then
    -- Fusion de deux sessions (add_court_booking) : l'historique suit les terrains, sauf la
    -- création de la session absorbée, qui reste avec elle (remplacée par un événement « merged »).
    update public.session_events set session_id = new.session_id
    where session_id = old.session_id and kind <> 'created';
    perform set_config('app.fusion_vers', new.session_id::text, true);
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    perform public.log_session_event(new.session_id, 'booking_removed', new.booked_by, jsonb_build_object(
      'court', new.court, 'starts_at', new.starts_at, 'ends_at', new.ends_at, 'price_cents', new.price_cents));
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
  return null;
end;
$$;

drop trigger session_events_update on public.court_bookings;
drop trigger session_events_delete on public.court_bookings;
create trigger session_events_update after update of session_id, price_cents, booked_by, co_payer, cancelled_at on public.court_bookings
  for each row execute function public.session_events_on_booking();

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
        'waiting', not public.session_player_is_playing(new.session_id, new.player_id)));
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
      'waiting', not public.session_player_is_playing(new.session_id, new.player_id)));
  end if;
  return new;
end;
$$;

drop trigger session_events_update on public.session_participants;
drop trigger session_events_delete on public.session_participants;
create trigger session_events_update after update of guests on public.session_participants
  for each row when (old.left_at is null and new.left_at is null)
  execute function public.session_events_on_participant();
create trigger session_events_leave before update of left_at on public.session_participants
  for each row when (old.left_at is null and new.left_at is not null)
  execute function public.session_events_on_participant();

revoke execute on function public.stamp_cancellation() from public, anon, authenticated;
