-- Récap hebdomadaire des comptes dans le groupe WhatsApp (/api/recap-comptes) : la tâche
-- planifiée n'a pas de joueur connecté et lit les soldes avec la clé secrète (rôle service_role).
-- Le projet en ligne n'ouvre pas les tables à l'API par défaut : on donne à service_role la
-- lecture des soldes, des remboursements et de ce que la vue balances lit (security_invoker).
-- Lecture seule ; service_role ignore déjà les règles RLS.
grant usage on schema public to service_role;
grant select on public.balances, public.session_players, public.profiles, public.sessions,
  public.court_bookings, public.session_participants, public.payments to service_role;
