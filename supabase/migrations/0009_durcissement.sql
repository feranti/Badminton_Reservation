-- Durcissement avant le passage du dépôt en public.
--
-- 1. Les rôles de l'API (anon, authenticated) ne gardent que les droits dont l'appli se sert.
--    Supabase leur donne par défaut TRUNCATE, TRIGGER et REFERENCES sur chaque table :
--    TRUNCATE en particulier ignore les règles RLS. L'API ne s'en sert pas, on les retire.
-- 2. Des limites de taille et de montant en base, pour qu'un appel direct à l'API
--    ne puisse pas enregistrer un nom de 1 Mo ou un terrain à un million d'euros.

revoke truncate, trigger, references
  on public.profiles, public.sessions, public.court_bookings, public.session_participants,
     public.payments, public.balances, public.session_players
  from anon, authenticated;

-- Même chose pour les tables créées plus tard.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

alter table public.profiles
  add constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 40);

alter table public.sessions
  add constraint sessions_venue_length check (char_length(venue) between 1 and 100),
  add constraint sessions_notes_length check (notes is null or char_length(notes) <= 500);

alter table public.court_bookings
  add constraint court_bookings_price_max check (price_cents <= 100000),
  add constraint court_bookings_qr_path_length check (qr_path is null or char_length(qr_path) <= 300);

alter table public.payments
  add constraint payments_amount_max check (amount_cents <= 1000000),
  add constraint payments_note_length check (note is null or char_length(note) <= 200);
