-- Efface toutes les données de test ajoutées par remplir.sql, sans toucher aux vraies données.
-- À exécuter dans Supabase > SQL Editor.

delete from public.payments
where note like '[TEST]%'
   or from_player in (select id from auth.users where email like 'test-%@example.com')
   or to_player in (select id from auth.users where email like 'test-%@example.com');

delete from public.sessions where notes like '[TEST]%';

-- Traces éventuelles des joueurs fictifs dans de vraies sessions
delete from public.session_participants
where player_id in (select id from auth.users where email like 'test-%@example.com');
delete from public.court_bookings
where booked_by in (select id from auth.users where email like 'test-%@example.com')
   or co_payer in (select id from auth.users where email like 'test-%@example.com')
   or created_by in (select id from auth.users where email like 'test-%@example.com');
update public.sessions
set created_by = (select id from auth.users where email not like 'test-%@example.com' order by created_at limit 1)
where created_by in (select id from auth.users where email like 'test-%@example.com');

delete from auth.users where email like 'test-%@example.com';

select 'Données de test effacées' as resultat,
  (select count(*) from auth.users where email like 'test-%@example.com') as joueurs_fictifs_restants;
