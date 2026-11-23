#!/usr/bin/env bash
# Vérification complète avant de livrer une modification :
#   1. lint, types et build de production
#   2. copie locale de Supabase remise à zéro, avec les mêmes droits qu'un projet en ligne
#   3. test de bout en bout à deux joueurs sur le build de production
#   4. visite de toutes les pages avec `next dev`, en échec si le serveur affiche une erreur
# Prérequis : Docker et Node.js. Usage : npm run check
set -euo pipefail
cd "$(dirname "$0")/.."

SUPABASE="npx --yes supabase@2.122.0"
PROD_PORT=3000
DEV_PORT=3001
LOG_DIR=$(mktemp -d)
PIDS=()
# Chaque serveur est lancé dans son propre groupe de processus pour pouvoir tout arrêter à la fin.
cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -- "-$pid" 2>/dev/null || true; done
  docker rm -f resas_vps_test >/dev/null 2>&1 || true
}
trap cleanup EXIT

step() { echo; echo "▶ $1"; }
# Attend qu'un serveur réponde (jusqu'à 60 s) : le premier démarrage de next dev peut être lent.
wait_for() {
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "✗ $1 ne répond pas après 60 s."
  exit 1
}

for port in $PROD_PORT $DEV_PORT; do
  if curl -s -o /dev/null "http://127.0.0.1:$port"; then
    echo "✗ Le port $port est déjà utilisé : arrêtez le serveur qui l'occupe."
    exit 1
  fi
done

step "Lint et types"
npm run lint
# PageProps, LayoutProps… sont générés par Next.js (.next/types, non suivi par git) : sur un
# clone neuf, il faut les créer avant tsc.
npx next typegen >/dev/null
npx tsc --noEmit

step "Copie locale de Supabase"
$SUPABASE start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta >/dev/null
$SUPABASE db reset >/dev/null
eval "$($SUPABASE status -o env 2>/dev/null)"
# Les droits de l'API sont remis à zéro puis donnés un par un par 0001_init.sql : la copie
# locale a donc les mêmes droits qu'un projet en ligne.
for player in alice bob carol dave eve frank; do
  curl -sf -o /dev/null -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SECRET_KEY" -H "Authorization: Bearer $SECRET_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$player@test.fr\",\"email_confirm\":true}"
done
# Limites en base (0001_init.sql) : un appel direct à l'API ne peut pas les contourner.
LIMITS=$(psql "$DB_URL" -q \
  -c "insert into public.sessions (venue, starts_at, ends_at, created_by) select repeat('x', 101), now(), now() + interval '1 hour', id from public.profiles limit 1" \
  -c "update public.profiles set display_name = repeat('x', 41)" 2>&1 || true)
if [[ "$LIMITS" != *sessions_venue_length* || "$LIMITS" != *profiles_display_name_length* ]]; then
  echo "✗ La base accepte un nom de gymnase ou de joueur trop long."
  exit 1
fi
sleep 15 # le service temps réel redémarre après la remise à zéro

export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export MAIL_URL="$MAILPIT_URL"
# Le serveur lit et écrit la base directement (src/lib/db.ts), avec les règles d'accès de chaque joueur.
export DATABASE_URL="$DB_URL"
# E-mails de liste d'attente : envoyés au serveur de test (Mailpit) de la copie locale.
# (SUPABASE_SECRET_KEY ne sert plus qu'au test de bout en bout, pour préparer les données.)
export SUPABASE_SECRET_KEY="$SECRET_KEY" SMTP_HOST=127.0.0.1 SMTP_PORT=54325 MAIL_FROM="resas@test.fr"
# Messages du groupe WhatsApp : envoyés au faux Green API lancé par le test de bout en bout.
export GREEN_API_PORT=54399 GREEN_API_URL="http://127.0.0.1:54399" GREEN_API_INSTANCE=1101 GREEN_API_TOKEN=jeton WHATSAPP_GROUP_ID="groupe@g.us"
# Tâches planifiées (/api/cron/…) : secret attendu par les routes, envoyé par le test.
export CRON_SECRET=secret-de-test

step "Build de production"
npm run build >"$LOG_DIR/build.log" 2>&1 || { cat "$LOG_DIR/build.log"; exit 1; }

step "Test de bout en bout (build de production)"
setsid npx next start -p $PROD_PORT -H 127.0.0.1 >"$LOG_DIR/prod.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$PROD_PORT/login"
APP_URL="http://127.0.0.1:$PROD_PORT" node tests/e2e/run.mjs

step "Rien n'est supprimé en base"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f tests/sql/annulations.sql

step "Droits de l'API"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f tests/sql/droits.sql

step "Accès direct à la base : identité des joueurs et règles d'accès"
node --conditions=react-server --experimental-strip-types --no-warnings tests/db/isolation.mts

step "Base du VPS : copie dans un Postgres seul (scripts/vps/copier-base.sh)"
# Même script que pour la bascule, de la copie locale de Supabase vers un Postgres 17 neuf (lancé
# avec l'image Postgres de Supabase, mais sans ses scripts : rien de Supabase n'y est installé).
PG_IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'supabase/postgres:')
VPS_PORT=54398
VPS_PASSWORD=mot-de-passe-de-test-assez-long
docker rm -f resas_vps_test >/dev/null 2>&1 || true
docker run -d --name resas_vps_test --network host -u postgres --entrypoint bash "$PG_IMAGE" -c \
  "initdb -D /tmp/pg -U postgres --auth=trust >/dev/null && exec postgres -D /tmp/pg -c listen_addresses=127.0.0.1 -c port=$VPS_PORT" >/dev/null
for _ in $(seq 1 30); do psql "postgresql://postgres@127.0.0.1:$VPS_PORT/postgres" -Atqc "select 1" >/dev/null 2>&1 && break; sleep 1; done
docker run --rm -i --network host --entrypoint bash \
  -e SOURCE_URL="$DB_URL" -e TARGET_URL="postgresql://postgres@127.0.0.1:$VPS_PORT/postgres" -e APP_PASSWORD="$VPS_PASSWORD" \
  "$PG_IMAGE" -s <scripts/vps/copier-base.sh
VPS_URL="postgresql://resas_app:$VPS_PASSWORD@127.0.0.1:$VPS_PORT/postgres"
DATABASE_URL="$VPS_URL" node --conditions=react-server --experimental-strip-types --no-warnings tests/db/isolation.mts
# Le site de production branché sur cette base : connexion par e-mail et visite de toutes les pages.
VPS_APP_PORT=3002
DATABASE_URL="$VPS_URL" setsid npx next start -p $VPS_APP_PORT -H 127.0.0.1 >"$LOG_DIR/vps.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$VPS_APP_PORT/login"
APP_URL="http://127.0.0.1:$VPS_APP_PORT" node tests/e2e/visit-pages.mjs
if grep -E "Error|⨯" "$LOG_DIR/vps.log"; then
  echo "✗ Le site branché sur la base du VPS a affiché des erreurs (voir ci-dessus)."
  exit 1
fi
echo "✓ Le site marche sur la base copiée, avec le compte resas_app"

step "Visite des pages avec next dev"
setsid npx next dev -p $DEV_PORT -H 127.0.0.1 >"$LOG_DIR/dev.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$DEV_PORT/login"
APP_URL="http://127.0.0.1:$DEV_PORT" node tests/e2e/visit-pages.mjs
# (la ligne « ⨯ turbopackFileSystemCacheForBuild » est la liste des réglages désactivés, pas une erreur)
if grep -E "Error|⨯" "$LOG_DIR/dev.log" | grep -v "⨯ turbopackFileSystemCacheForBuild$"; then
  echo "✗ Le serveur de développement a affiché des erreurs (voir ci-dessus)."
  exit 1
fi
echo "✓ Aucune erreur dans le serveur de développement"

echo
echo "Tout est bon."
