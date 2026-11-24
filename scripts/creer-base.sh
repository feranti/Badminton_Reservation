#!/usr/bin/env bash
# Crée la base du site dans un Postgres 17 vide : socle (supabase/socle.sql), toutes les migrations
# dans l'ordre, puis le compte du site resas_app, avec les mêmes droits que sur le VPS.
# Utilisé par npm run check et pour une base de développement (voir README).
# Variables :
#   TARGET_URL    adresse de la base, avec l'utilisateur postgres (propriétaire)
#   APP_PASSWORD  mot de passe à donner au compte du site (resas_app), au moins 24 caractères
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TARGET_URL:?TARGET_URL manquante (adresse de la base, utilisateur postgres)}"
: "${APP_PASSWORD:?APP_PASSWORD manquant (mot de passe du compte resas_app)}"
if [ "${#APP_PASSWORD}" -lt 24 ]; then
  echo "✗ APP_PASSWORD doit faire au moins 24 caractères." >&2
  exit 1
fi

dst() { PGOPTIONS="-c client_min_messages=error" psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
[ "$(dst -At -c "select to_regnamespace('auth') is null")" = "t" ] \
  || { echo "✗ La base n'est pas vide." >&2; exit 1; }

dst -1 -f supabase/socle.sql
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  dst -1 -f "$migration" >/dev/null
done

dst -v app_password="$APP_PASSWORD" <<'SQL'
begin;
-- Restes du stockage et du temps réel de Supabase : la base du VPS n'en a pas.
drop publication supabase_realtime;
drop schema storage cascade;

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
echo "✓ Base créée. DATABASE_URL du site : postgresql://resas_app:…@<hôte>:<port>/<base>"
