-- Droits d'accès explicites pour les joueurs connectés.
-- Les nouveaux projets Supabase n'ouvrent plus automatiquement les tables à l'API :
-- sans ces droits, toutes les lectures échouent avec « permission denied ».
-- Les règles RLS restent appliquées en plus de ces droits.

grant usage on schema public to authenticated;

grant select on public.profiles, public.balances to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, insert, update, delete on public.sessions, public.court_bookings to authenticated;
grant select, insert, delete on public.session_participants to authenticated;

grant select, insert, delete on public.payments to authenticated;
grant update (confirmed_at) on public.payments to authenticated;
