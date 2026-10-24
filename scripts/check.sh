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
cleanup() { for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -- "-$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

step() { echo; echo "▶ $1"; }

for port in $PROD_PORT $DEV_PORT; do
  if curl -s -o /dev/null "http://127.0.0.1:$port"; then
    echo "✗ Le port $port est déjà utilisé : arrêtez le serveur qui l'occupe."
    exit 1
  fi
done

step "Lint et types"
npm run lint
npx tsc --noEmit

step "Copie locale de Supabase"
$SUPABASE start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,storage-api,postgres-meta >/dev/null
$SUPABASE db reset >/dev/null
eval "$($SUPABASE status -o env 2>/dev/null)"
# Un projet Supabase en ligne n'ouvre pas les tables à l'API par défaut : on retire les droits
# accordés par la copie locale, puis on remet uniquement ceux de nos migrations.
psql "$DB_URL" -q -c "revoke all on all tables in schema public from anon, authenticated;" \
  -f supabase/migrations/0006_droits_api.sql
for player in alice bob; do
  curl -sf -o /dev/null -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SECRET_KEY" -H "Authorization: Bearer $SECRET_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$player@test.fr\",\"email_confirm\":true}"
done
sleep 15 # le service temps réel redémarre après la remise à zéro

export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export MAIL_URL="$MAILPIT_URL"

step "Build de production"
npm run build >"$LOG_DIR/build.log" 2>&1 || { cat "$LOG_DIR/build.log"; exit 1; }

step "Test de bout en bout (build de production)"
setsid npx next start -p $PROD_PORT -H 127.0.0.1 >"$LOG_DIR/prod.log" 2>&1 &
PIDS+=($!)
sleep 4
APP_URL="http://127.0.0.1:$PROD_PORT" node tests/e2e/run.mjs

step "Visite des pages avec next dev"
setsid npx next dev -p $DEV_PORT -H 127.0.0.1 >"$LOG_DIR/dev.log" 2>&1 &
PIDS+=($!)
sleep 8
APP_URL="http://127.0.0.1:$DEV_PORT" node tests/e2e/visit-pages.mjs
if grep -E "Error|⨯" "$LOG_DIR/dev.log"; then
  echo "✗ Le serveur de développement a affiché des erreurs (voir ci-dessus)."
  exit 1
fi
echo "✓ Aucune erreur dans le serveur de développement"

echo
echo "Tout est bon."
