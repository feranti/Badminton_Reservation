-- Droits de l'API : les tables créées après 0001 recevaient trop de droits.
--
-- 0001 retire tous les droits des joueurs (authenticated) et des visiteurs (anon), puis les donne
-- un par un. Mais pour les tables créées plus tard, elle ne retirait que TRUNCATE, TRIGGER et
-- REFERENCES : selon les réglages du projet, booking_qr_codes (0003) et session_events (0007)
-- ont donc pu recevoir SELECT, INSERT, UPDATE et DELETE pour anon et authenticated, sur toutes
-- les colonnes. Les règles RLS bloquaient presque tout ; restait la possibilité pour un joueur
-- d'écrire dans l'historique un passage liste d'attente ↔ joueurs antidaté ou avec un détail
-- inventé. Après ce script, les droits sont les mêmes en local et en ligne.

-- 1. Plus aucun droit par défaut pour les tables, séquences et fonctions créées plus tard :
--    chaque migration donne explicitement ceux dont l'appli a besoin.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 2. QR codes : lecture, ajout et remplacement pour les joueurs (pas de suppression depuis 0008).
revoke all on public.booking_qr_codes from anon, authenticated;
grant select, insert, update on public.booking_qr_codes to authenticated;

-- 3. Historique : lecture, et ajout des seuls passages liste d'attente ↔ joueurs (session, type,
--    joueur). L'auteur (actor_id) et la date sont remplis par la base, le reste par les déclencheurs.
revoke all on public.session_events from anon, authenticated;
grant select on public.session_events to authenticated;
grant insert (session_id, kind, player_id) on public.session_events to authenticated;
revoke all on sequence public.session_events_id_seq from anon, authenticated;
