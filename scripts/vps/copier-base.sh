#!/usr/bin/env bash
# Copie la base de Supabase dans un Postgres 17 seul (celui du VPS), une fois, au moment de la bascule.
#
# À lancer sur le VPS, dans un conteneur postgres:17 relié au réseau de Dokploy (voir README,
# « Base sur le VPS ») :
#   docker run --rm -i --network dokploy-network --env-file copie.env postgres:17 bash -s < copier-base.sh
#
# Variables (fichier copie.env, à supprimer ensuite : il contient des mots de passe) :
#   SOURCE_URL    adresse de la base Supabase (Session pooler), avec son mot de passe
#   TARGET_URL    adresse de la base du VPS, avec l'utilisateur postgres (propriétaire)
#   APP_PASSWORD  mot de passe à donner au compte du site (resas_app), au moins 24 caractères
#
# Ce que fait le script, dans l'ordre :
#   1. refuse de toucher une base déjà remplie ;
#   2. crée ce que Supabase fournissait : les rôles anon, authenticated et service_role, le schéma
#      auth avec la table des joueurs (auth.users : identifiant et e-mail) et la fonction auth.uid() ;
#   3. recopie les joueurs, puis toutes les tables, vues, fonctions, règles d'accès et droits du
#      schéma public, puis toutes les données (sans redéclencher l'historique) ;
#   4. crée le compte du site, resas_app : il lit et écrit les données mais ne peut rien créer ni
#      supprimer dans le schéma, et n'est pas superutilisateur ;
#   5. compare le nombre de lignes de chaque table entre les deux bases.
# Supabase n'est que lu : rien n'y est modifié.
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL manquante (adresse de la base Supabase)}"
: "${TARGET_URL:?TARGET_URL manquante (adresse de la base du VPS)}"
: "${APP_PASSWORD:?APP_PASSWORD manquant (mot de passe du compte resas_app)}"
if [ "${#APP_PASSWORD}" -lt 24 ]; then
  echo "✗ APP_PASSWORD doit faire au moins 24 caractères." >&2
  exit 1
fi

src() { psql "$SOURCE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
dst() { psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "▶ Vérifications"
[ "$(src -At -c "select to_regclass('public.auth_sessions') is not null")" = "t" ] \
  || { echo "✗ La base source n'a pas encore les migrations 0011 et 0012." >&2; exit 1; }
[ "$(dst -At -c "select to_regclass('public.sessions') is null and to_regnamespace('auth') is null")" = "t" ] \
  || { echo "✗ La base du VPS n'est pas vide : supprimez-la et recréez-la dans Dokploy avant de recommencer." >&2; exit 1; }
[ "$(dst -At -c "select rolsuper from pg_roles where rolname = current_user")" = "t" ] \
  || { echo "✗ TARGET_URL doit utiliser l'utilisateur postgres de la base du VPS." >&2; exit 1; }

echo "▶ Socle : rôles, schéma auth, auth.uid()"
dst <<'SQL'
begin;
-- Rôles des règles d'accès (comme Supabase) : jamais utilisés pour se connecter.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- Joueurs : seulement ce que le site utilise. Un joueur s'ajoute par
--   insert into auth.users (email) values ('nom@exemple.fr');
-- (son profil est créé par le déclencheur on_auth_user_created, ajouté plus bas).
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
commit;
SQL

echo "▶ Joueurs"
src -c "\copy (select id, lower(email), coalesce(raw_user_meta_data, '{}'), created_at, deleted_at, banned_until from auth.users where email is not null) to '$WORK/users.copy'"
dst -c "\copy auth.users (id, email, raw_user_meta_data, created_at, deleted_at, banned_until) from '$WORK/users.copy'"

echo "▶ Schéma public : tables, vues, fonctions, règles d'accès et droits"
pg_dump "$SOURCE_URL" --schema-only --schema=public --no-owner --no-publications --no-subscriptions \
  --no-security-labels --no-table-access-method -f "$WORK/schema.sql"
# Droits et réglages propres aux rôles internes de Supabase, absents d'un Postgres seul.
grep -vE '^(ALTER DEFAULT PRIVILEGES FOR ROLE (supabase_admin|supabase_auth_admin|supabase_storage_admin))|^(GRANT|REVOKE) .* (TO|FROM) (supabase_\w+|dashboard_user|authenticator|pgbouncer|pg_database_owner)\b' \
  "$WORK/schema.sql" | grep -vE '^CREATE SCHEMA public;$|^COMMENT ON SCHEMA public ' >"$WORK/schema-vps.sql"
dst -1 -f "$WORK/schema-vps.sql"

echo "▶ Données (déclencheurs désactivés : l'historique n'est pas réécrit)"
pg_dump "$SOURCE_URL" --data-only --schema=public --disable-triggers -f "$WORK/data.sql"
dst -1 -f "$WORK/data.sql" >/dev/null

echo "▶ Création du profil d'un nouveau joueur, et compte du site resas_app"
dst -v app_password="$APP_PASSWORD" <<'SQL'
begin;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Compte du site : lit et écrit les données en ignorant les règles d'accès pour les tâches
-- planifiées et les e-mails (adminDb), et prend le rôle authenticated pour chaque requête de
-- joueur (playerDb). Ni superutilisateur, ni propriétaire : il ne peut pas modifier le schéma.
select format('create role resas_app login bypassrls password %L', :'app_password') \gexec
grant authenticated, anon to resas_app;
revoke create on schema public from public;
grant usage on schema public, auth to resas_app;
grant select, insert, update, delete on all tables in schema public to resas_app;
grant usage, select, update on all sequences in schema public to resas_app;
grant execute on all functions in schema public to resas_app;
grant select on auth.users to resas_app;
grant execute on function auth.uid() to resas_app;
-- Les tables ajoutées plus tard par une migration lancée en postgres restent ouvertes au site.
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to resas_app;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to resas_app;
alter default privileges for role postgres in schema public grant execute on functions to resas_app;
commit;
SQL

echo "▶ Comparaison du nombre de lignes"
count_sql="select string_agg(format('%s=%s', t, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', t), false, true, '')))[1]::text), ' ' order by t)
  from unnest(array['auth.users'] || (select array_agg('public.' || quote_ident(tablename)) from pg_tables where schemaname = 'public')) as t"
before=$(src -At -c "select count(*) from auth.users where email is not null" )
after=$(dst -At -c "select count(*) from auth.users")
src_counts=$(src -At -c "$count_sql" | sed -E "s/auth\.users=[0-9]+/auth.users=$before/")
dst_counts=$(dst -At -c "$count_sql" | sed -E "s/auth\.users=[0-9]+/auth.users=$after/")
if [ "$src_counts" != "$dst_counts" ]; then
  echo "✗ Nombres de lignes différents :" >&2
  echo "  Supabase : $src_counts" >&2
  echo "  VPS      : $dst_counts" >&2
  exit 1
fi
echo "$dst_counts" | tr ' ' '\n' | sed 's/^/  /'
echo "✓ Base copiée. Prochaine étape : DATABASE_URL du site = postgresql://resas_app:…@<hôte de la base>:5432/<base>"
