-- Données de test pour Badminton Résas : 20 réservations, 8 joueurs fictifs, quelques remboursements.
-- À exécuter dans Supabase > SQL Editor. Tout est repérable :
--   - joueurs fictifs : e-mail test-…@example.com, nom suivi de « (test) » ;
--   - sessions : remarques qui commencent par [TEST] ;
--   - remboursements : note qui commence par [TEST].
-- Pour tout effacer : supabase/donnees-test/vider.sql.
-- Le vrai compte utilisé dans les scénarios (« vous », variable « me ») est le plus ancien compte
-- du projet. Pour en choisir un autre, remplacez la requête qui remplit « me » plus bas.

-- Joueur fictif (compte sans mot de passe, qui ne peut pas se connecter)
create function pg_temp.test_player(p_name text, p_slug text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test-' || p_slug || '@example.com', '', now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p_name || ' (test)'),
          now(), now());
  return v_id;
end $$;

-- Jour (relatif à aujourd'hui) et heure de Paris → horodatage
create function pg_temp.at(p_days int, p_time time) returns timestamptz language sql as $$
  select ((current_date + p_days) + p_time) at time zone 'Europe/Paris'
$$;

create function pg_temp.session(p_notes text, p_by uuid) returns uuid language sql as $$
  insert into public.sessions (venue, starts_at, ends_at, notes, created_by)
  values ('Le Prisme, Bobigny', now(), now() + interval '1 hour', '[TEST] ' || p_notes, p_by)
  returning id
$$;

create function pg_temp.booking(p_session uuid, p_court int, p_day int, p_start time, p_end time,
                                p_price int, p_by uuid, p_co uuid default null) returns void language sql as $$
  insert into public.court_bookings (session_id, court, starts_at, ends_at, price_cents, booked_by, co_payer, created_by)
  values (p_session, p_court, pg_temp.at(p_day, p_start), pg_temp.at(p_day, p_end), p_price, p_by, p_co, p_by);
  select public.refresh_session_slot(p_session);
$$;

-- Inscriptions dans l'ordre donné (premier inscrit, premier servi)
create function pg_temp.players(p_session uuid, p_ids uuid[]) returns void language sql as $$
  insert into public.session_participants (session_id, player_id, added_at)
  select p_session, id, now() - interval '1 day' + n * interval '1 minute'
  from unnest(p_ids) with ordinality as t(id, n)
$$;

do $$
declare
  me uuid;
  lea uuid; marc uuid; sofia uuid; karim uuid; nina uuid; paul uuid; julie uuid; yanis uuid;
  s uuid;
begin
  select id into me from auth.users where email not like 'test-%@example.com' order by created_at limit 1;
  if me is null then raise exception 'Aucun compte : créez d''abord le vôtre (Authentication > Users)'; end if;
  if exists (select 1 from auth.users where email like 'test-%@example.com') then
    raise exception 'Des données de test existent déjà : lancez d''abord vider.sql';
  end if;

  lea := pg_temp.test_player('Léa', 'lea');         marc := pg_temp.test_player('Marc', 'marc');
  sofia := pg_temp.test_player('Sofia', 'sofia');   karim := pg_temp.test_player('Karim', 'karim');
  nina := pg_temp.test_player('Nina', 'nina');      paul := pg_temp.test_player('Paul', 'paul');
  julie := pg_temp.test_player('Julie', 'julie');   yanis := pg_temp.test_player('Yanis', 'yanis');

  -- ── Sessions passées (pour les comptes) ───────────────────────────────
  -- 1. Il y a 14 jours : 2 terrains, le 7 payé à deux. 6 joueurs sur 8.
  s := pg_temp.session('Passée, 2 terrains, terrain 7 payé à deux', me);
  perform pg_temp.booking(s, 6, -14, '20:00', '22:00', 2400, me);
  perform pg_temp.booking(s, 7, -14, '20:00', '22:00', 2400, me, lea);
  perform pg_temp.players(s, array[me, lea, marc, sofia, karim, nina]);

  -- 2. Il y a 7 jours : terrain 8 en deux créneaux d'une heure qui se suivent + terrain 9 sur deux heures.
  --    Complète (8/8) : Léa, en liste d'attente, ne paie pas.
  s := pg_temp.session('Passée, créneaux qui se suivent, complète avec liste d''attente', marc);
  perform pg_temp.booking(s, 8, -7, '20:00', '21:00', 1200, marc);
  perform pg_temp.booking(s, 8, -7, '21:00', '22:00', 1200, marc);
  perform pg_temp.booking(s, 9, -7, '20:00', '22:00', 2400, sofia, karim);
  perform pg_temp.players(s, array[me, marc, sofia, karim, paul, julie, yanis, nina, lea]);

  -- 3. Il y a 3 jours, à midi : 1 terrain, 2 joueurs.
  s := pg_temp.session('Passée, midi', me);
  perform pg_temp.booking(s, 10, -3, '12:00', '13:00', 1200, me);
  perform pg_temp.players(s, array[me, julie]);

  -- ── Sessions à venir ──────────────────────────────────────────────────
  -- 4. Dans 2 jours : 3 terrains, 5 joueurs sur 12, vous compris.
  s := pg_temp.session('À venir, 3 terrains, places libres', me);
  perform pg_temp.booking(s, 6, 2, '20:00', '22:00', 2400, me);
  perform pg_temp.booking(s, 7, 2, '20:00', '22:00', 2400, paul);
  perform pg_temp.booking(s, 8, 2, '20:00', '22:00', 2400, nina, yanis);
  perform pg_temp.players(s, array[me, paul, nina, yanis, sofia]);

  -- 5. Dans 4 jours : terrain 12 en deux créneaux, complète (4/4). Liste d'attente : Léa puis vous.
  --    Retirez un joueur : Léa passe joueuse (e-mail vers son adresse fictive) et vous devenez n°1.
  s := pg_temp.session('À venir, complète, vous êtes n°2 sur la liste d''attente', karim);
  perform pg_temp.booking(s, 12, 4, '20:00', '21:00', 1200, karim);
  perform pg_temp.booking(s, 12, 4, '21:00', '22:00', 1200, karim);
  perform pg_temp.players(s, array[karim, marc, sofia, paul, lea, me]);

  -- 6 et 7. Dans 6 jours : une session à midi et une le soir, le même jour.
  s := pg_temp.session('À venir, midi, complète sans vous', julie);
  perform pg_temp.booking(s, 9, 6, '12:00', '13:00', 1200, julie);
  perform pg_temp.players(s, array[julie, yanis, nina, karim]);
  s := pg_temp.session('À venir, le soir du même jour que la session de midi', me);
  perform pg_temp.booking(s, 10, 6, '20:00', '22:00', 2400, me);
  perform pg_temp.booking(s, 11, 6, '20:00', '22:00', 2400, lea, me);
  perform pg_temp.players(s, array[me, lea, marc]);

  -- 8. Dans 9 jours : terrain 13 puis terrain 14 (créneaux qui se suivent, terrains différents).
  s := pg_temp.session('À venir, terrain 13 puis terrain 14', sofia);
  perform pg_temp.booking(s, 13, 9, '20:00', '21:00', 1200, sofia);
  perform pg_temp.booking(s, 14, 9, '21:00', '22:00', 1200, sofia, paul);
  perform pg_temp.players(s, array[sofia, paul]);

  -- 9. Dans 11 jours : 4 terrains, 8 joueurs sur 16, sans vous (pour tester « Je m'inscris »).
  s := pg_temp.session('À venir, grande session, sans vous', yanis);
  perform pg_temp.booking(s, 6, 11, '20:00', '22:00', 2400, yanis);
  perform pg_temp.booking(s, 7, 11, '20:00', '22:00', 2400, yanis);
  perform pg_temp.booking(s, 8, 11, '20:00', '22:00', 2400, julie, nina);
  perform pg_temp.booking(s, 9, 11, '20:00', '22:00', 2400, marc);
  perform pg_temp.players(s, array[yanis, julie, nina, marc, lea, sofia, karim, paul]);

  -- ── Remboursements ────────────────────────────────────────────────────
  insert into public.payments (from_player, to_player, amount_cents, note, confirmed_at, created_by) values
    (lea, me, 1000, '[TEST] confirmé', now() - interval '2 days', lea),
    (marc, me, 1500, '[TEST] à confirmer par vous', null, marc),
    (me, sofia, 500, '[TEST] en attente de Sofia', null, me);
end $$;

select 'Données de test ajoutées' as resultat,
  (select count(*) from public.court_bookings c join public.sessions s on s.id = c.session_id
   where s.notes like '[TEST]%') as reservations,
  (select count(*) from auth.users where email like 'test-%@example.com') as joueurs_fictifs;
