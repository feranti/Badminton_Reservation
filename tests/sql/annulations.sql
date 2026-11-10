-- Rien n'est supprimé en base (migration 0008) : à lancer après le test de bout en bout,
-- qui annule une session, un terrain et une inscription.
-- Usage : psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/sql/annulations.sql
do $$
begin
  if not exists (select 1 from public.sessions where cancelled_at is not null and cancelled_by is not null) then
    raise exception 'Aucune session annulée (avec son auteur) gardée en base';
  end if;
  if not exists (select 1 from public.court_bookings where cancelled_at is not null and cancelled_by is not null) then
    raise exception 'Aucun terrain annulé (avec son auteur) gardé en base';
  end if;
  if not exists (select 1 from public.session_participants where left_at is not null and left_by is not null) then
    raise exception 'Aucune désinscription (avec son auteur) gardée en base';
  end if;
end;
$$;

-- Un joueur connecté ne peut rien supprimer ; un QR code retiré et un remboursement annulé restent en base.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.profiles order by display_name limit 1), 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
do $$
declare
  v_me uuid := auth.uid();
  v_other uuid := (select id from public.profiles where id <> auth.uid() limit 1);
  v_payment uuid;
  t text;
begin
  foreach t in array array['sessions', 'court_bookings', 'session_participants', 'booking_qr_codes', 'payments'] loop
    begin
      execute format('delete from public.%I', t);
      raise exception 'Suppression permise dans %', t;
    exception when insufficient_privilege then null;
    end;
  end loop;

  update public.booking_qr_codes set removed_at = now() where hour = 0;
  if not exists (select 1 from public.booking_qr_codes where hour = 0 and removed_at is not null and removed_by = v_me) then
    raise exception 'Le QR code retiré doit rester en base, avec son auteur';
  end if;

  insert into public.payments (from_player, to_player, amount_cents) values (v_me, v_other, 100) returning id into v_payment;
  perform public.cancel_payment(v_payment);
  if not exists (select 1 from public.payments where id = v_payment and cancelled_at is not null and cancelled_by = v_me) then
    raise exception 'Le remboursement annulé doit rester en base, avec son auteur';
  end if;
end;
$$;
rollback;

select 'ok' as annulations;
