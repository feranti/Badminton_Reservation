-- Connexion par e-mail gérée par le site (lien et code à usage unique, puis session), sans
-- Supabase Auth. Les joueurs restent dans auth.users (identifiant et adresse e-mail).
-- Ces deux tables ne servent qu'au serveur : RLS sans aucune règle et aucun droit pour les
-- joueurs ni les visiteurs (le serveur s'y connecte comme propriétaire de la base).

-- 1. Demandes de connexion : le lien et le code envoyés par e-mail, gardés hachés (SHA-256).
--    Valables une heure, une seule fois, 5 essais de code au plus.
create table public.login_tokens (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  link_hash text not null unique,
  code_hash text not null,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index login_tokens_user_id on public.login_tokens (user_id, created_at desc);

-- 2. Sessions : le cookie du navigateur contient un jeton aléatoire, la base son empreinte.
--    Une session non utilisée pendant 90 jours expire ; « Se déconnecter » la supprime.
create table public.auth_sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_sessions_user_id on public.auth_sessions (user_id);

alter table public.login_tokens enable row level security;
alter table public.auth_sessions enable row level security;
revoke all on public.login_tokens, public.auth_sessions from anon, authenticated;
revoke all on sequence public.login_tokens_id_seq from anon, authenticated;
