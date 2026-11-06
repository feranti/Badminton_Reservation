-- Rappel au groupe WhatsApp 72h avant une session où il manque au moins 4 joueurs (un terrain
-- entier vide), pour que les oubliés s'inscrivent ou que les capitaines annulent à temps
-- (au Prisme, l'annulation doit se faire 48h avant).
-- Le rappel est envoyé une seule fois : cette colonne garde l'heure de l'envoi.
-- Seule la route /api/rappels (clé secrète, sans RLS) l'écrit : aucun droit en plus pour les joueurs.
alter table public.sessions add column reminder_sent_at timestamptz;

-- La route lit la base avec la clé secrète (rôle service_role). Le projet en ligne n'ouvre pas
-- les tables à l'API par défaut, même pour ce rôle : on donne les droits dont elle a besoin.
grant usage on schema public to service_role;
grant select on public.sessions, public.court_bookings, public.session_players to service_role;
grant update (reminder_sent_at) on public.sessions to service_role;
