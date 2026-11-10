-- Droits de l'API (migrations 0009 et 0010) : les visiteurs non connectés n'ont aucun droit sur le schéma
-- public, et les joueurs ne peuvent écrire dans l'historique que les colonnes prévues.
-- Usage : psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/sql/droits.sql
do $$
declare
  v_found text;
begin
  select string_agg(distinct table_name || ' (' || privilege_type || ')', ', ') into v_found
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon';
  if v_found is not null then
    raise exception 'Les visiteurs non connectés ont des droits sur : %', v_found;
  end if;

  select string_agg(c.relname, ', ') into v_found
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
    and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'usage'));
  if v_found is not null then
    raise exception 'Séquences ouvertes aux joueurs ou aux visiteurs : %', v_found;
  end if;

  select string_agg(p.proname, ', ') into v_found
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute');
  if v_found is not null then
    raise exception 'Fonctions ouvertes aux visiteurs non connectés : %', v_found;
  end if;

  if has_table_privilege('authenticated', 'public.session_events', 'update')
     or has_table_privilege('authenticated', 'public.session_events', 'delete')
     or has_column_privilege('authenticated', 'public.session_events', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.session_events', 'details', 'insert')
     or has_column_privilege('authenticated', 'public.session_events', 'actor_id', 'insert') then
    raise exception 'Les joueurs ne doivent ajouter à l''historique que la session, le type et le joueur';
  end if;

  -- Migration 0010 : auteurs d'annulation, créateurs, dates et rappels remplis par la base seulement.
  select string_agg(format('%s.%s (%s)', t, c, p), ', ') into v_found
  from (select table_name::text as t, column_name::text as c from information_schema.columns
        where table_schema = 'public'
          and table_name in ('sessions', 'court_bookings', 'session_participants', 'payments', 'booking_qr_codes')
          and column_name in ('cancelled_by', 'left_by', 'removed_by', 'created_by', 'created_at', 'added_at',
                              'reminder_sent_at', 'merged_into', 'paid_on')) as cols
  cross join unnest(array['insert', 'update']) as p
  where has_column_privilege('authenticated', format('public.%I', t), c, p);
  if v_found is not null then
    raise exception 'Colonnes que les joueurs ne doivent pas écrire : %', v_found;
  end if;
  if has_table_privilege('authenticated', 'public.sessions', 'insert')
     or has_table_privilege('authenticated', 'public.court_bookings', 'insert')
     or has_column_privilege('authenticated', 'public.sessions', 'cancelled_at', 'insert') then
    raise exception 'Sessions et terrains ne se créent que par add_court_booking';
  end if;

  if has_table_privilege('authenticated', 'public.booking_qr_codes', 'delete') then
    raise exception 'Les joueurs ne doivent pas pouvoir supprimer un QR code';
  end if;
end;
$$;

-- Une table créée après coup n'est ouverte à personne tant qu'une migration ne le décide pas.
begin;
create table public.droits_test (id int);
do $$
begin
  if has_table_privilege('anon', 'public.droits_test', 'select')
     or has_table_privilege('authenticated', 'public.droits_test', 'select') then
    raise exception 'Une nouvelle table est ouverte à l''API par défaut';
  end if;
end;
$$;
rollback;

select 'ok' as droits;
