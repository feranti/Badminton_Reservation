-- Socle d'une base neuve, à exécuter avant supabase/migrations/ (scripts/creer-base.sh le fait).
-- Les migrations ont été écrites pour Supabase : elles supposent ce que Supabase fournissait. Ce
-- script le recrée sur un Postgres 18 seul, comme pour la base du VPS lors de la bascule depuis
-- Supabase :
--   - les rôles des règles d'accès anon, authenticated et service_role ;
--   - le schéma auth, avec la table des joueurs (auth.users) et la fonction auth.uid() ;
--   - de quoi passer les anciennes instructions de stockage et de temps réel de Supabase (0001 et
--     0003), supprimé ensuite par creer-base.sh : la base du VPS n'en a pas.

-- Rôles des règles d'accès : jamais utilisés pour se connecter.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- Joueurs : seulement ce que le site utilise. Un joueur s'ajoute par
--   insert into auth.users (email) values ('nom@exemple.fr');
-- (son profil est créé par le déclencheur on_auth_user_created de 0001_init.sql).
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  banned_until timestamptz
);
create unique index users_email_key on auth.users (lower(email));

-- Joueur de la requête en cours : le serveur le place dans request.jwt.claims (src/lib/db.ts).
create function auth.uid() returns uuid
  language sql stable
  set search_path = ''
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;
revoke all on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Anciens services de Supabase, cités par 0001 et 0003 (supprimés après les migrations).
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text);
create publication supabase_realtime;

