#!/usr/bin/env bash
# Vérification complète avant de livrer une modification :
#   1. lint, types et build de production
#   2. base neuve dans un Postgres 17 seul (scripts/creer-base.sh), avec les mêmes droits que celle
#      du VPS, et un Mailpit pour recevoir les e-mails
#   3. test de bout en bout à deux joueurs sur le build de production
#   4. visite de toutes les pages avec `next dev`, en échec si le serveur affiche une erreur
# Prérequis : Docker et Node.js. Usage : npm run check
set -euo pipefail
cd "$(dirname "$0")/.."

# Conteneurs de test : ports à part, pour ne gêner ni être gêné par une autre base en local.
DB_PORT=54330
MAIL_PORT=54324
SMTP_TEST_PORT=54325
PROD_PORT=3000
DEV_PORT=3001
LOG_DIR=$(mktemp -d)
PIDS=()
# Chaque serveur est lancé dans son propre groupe de processus pour pouvoir tout arrêter à la fin.
cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -- "-$pid" 2>/dev/null || true; done
  docker rm -f resas_check_db resas_check_mail >/dev/null 2>&1 || true
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

for port in $PROD_PORT $DEV_PORT 3003; do
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

step "Base neuve (Postgres 17) et Mailpit"
docker rm -f resas_check_db resas_check_mail >/dev/null 2>&1 || true
docker run -d --name resas_check_db -p 127.0.0.1:$DB_PORT:5432 -e POSTGRES_PASSWORD=postgres postgres:17 >/dev/null
docker run -d --name resas_check_mail -p 127.0.0.1:$MAIL_PORT:8025 -p 127.0.0.1:$SMTP_TEST_PORT:1025 axllent/mailpit:v1.31.3 >/dev/null
DB_URL="postgresql://postgres:postgres@127.0.0.1:$DB_PORT/postgres"
for _ in $(seq 1 30); do psql "$DB_URL" -Atqc "select 1" >/dev/null 2>&1 && break; sleep 1; done
APP_PASSWORD=mot-de-passe-de-test-assez-long
TARGET_URL="$DB_URL" APP_PASSWORD="$APP_PASSWORD" bash scripts/creer-base.sh >/dev/null
# Joueurs de test : un joueur s'ajoute dans auth.users, son profil est créé par la base.
psql "$DB_URL" -q -v ON_ERROR_STOP=1 \
  -c "insert into auth.users (email) select p || '@test.fr' from unnest(array['alice','bob','carol','dave','eve','frank']) as p"
# Limites en base (0001_init.sql) : un appel direct ne peut pas les contourner.
LIMITS=$(psql "$DB_URL" -q \
  -c "insert into public.sessions (venue, starts_at, ends_at, created_by) select repeat('x', 101), now(), now() + interval '1 hour', id from public.profiles limit 1" \
  -c "update public.profiles set display_name = repeat('x', 41)" 2>&1 || true)
if [[ "$LIMITS" != *sessions_venue_length* || "$LIMITS" != *profiles_display_name_length* ]]; then
  echo "✗ La base accepte un nom de gymnase ou de joueur trop long."
  exit 1
fi
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$MAIL_PORT" && break; sleep 1; done

export MAIL_URL="http://127.0.0.1:$MAIL_PORT"
# Le test de bout en bout prépare certaines données en postgres (joueur banni, sessions du rappel).
export ADMIN_DB_URL="$DB_URL"
# Le site se connecte avec le compte resas_app, comme sur le VPS : il lit et écrit la base
# directement (src/lib/db.ts), avec les règles d'accès de chaque joueur.
export DATABASE_URL="postgresql://resas_app:$APP_PASSWORD@127.0.0.1:$DB_PORT/postgres"
# E-mails (connexion, liste d'attente) : envoyés au Mailpit de test.
export SMTP_HOST=127.0.0.1 SMTP_PORT=$SMTP_TEST_PORT MAIL_FROM="resas@test.fr"

# Messages du groupe WhatsApp : envoyés au faux Green API lancé par le test de bout en bout.
export GREEN_API_PORT=54399 GREEN_API_URL="http://127.0.0.1:54399" GREEN_API_INSTANCE=1101 GREEN_API_TOKEN=jeton WHATSAPP_GROUP_ID="groupe@g.us"
# Tâches planifiées (/api/cron/…) : secret attendu par les routes, envoyé par le test.
export CRON_SECRET=secret-de-test

step "Build de production"
npm run build >"$LOG_DIR/build.log" 2>&1 || { cat "$LOG_DIR/build.log"; exit 1; }

step "Test de bout en bout (build de production)"
# APP_URL : adresse publique des liens (e-mails, WhatsApp). Les autres serveurs de test s'en passent
# et prennent l'en-tête Host de la requête, comme en local.
APP_URL="http://127.0.0.1:$PROD_PORT" setsid npx next start -p $PROD_PORT -H 127.0.0.1 >"$LOG_DIR/prod.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$PROD_PORT/login"
APP_URL="http://127.0.0.1:$PROD_PORT" node tests/e2e/run.mjs

step "Rien n'est supprimé en base"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f tests/sql/annulations.sql

step "Droits de l'API"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f tests/sql/droits.sql

step "Accès direct à la base : identité des joueurs et règles d'accès"
node --conditions=react-server --experimental-strip-types --no-warnings tests/db/isolation.mts

step "Serveur autonome du conteneur, sans APP_URL : liens des messages WhatsApp"
# Comme sur le VPS (Dockerfile) : HOSTNAME=0.0.0.0 derrière un proxy. Le lien du récap doit être
# l'adresse du site (en-tête Host), pas https://0.0.0.0:3000.
node tests/e2e/adresse-publique.mjs

step "Ancien site : message de déménagement (NOUVEAU_SITE)"
MOVED_PORT=3003
NOUVEAU_SITE=https://nouveau.exemple.fr DATABASE_URL=postgresql://personne@127.0.0.1:1/aucune \
  setsid npx next start -p $MOVED_PORT -H 127.0.0.1 >"$LOG_DIR/moved.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$MOVED_PORT/login"
APP_URL="http://127.0.0.1:$MOVED_PORT" NOUVEAU_SITE=https://nouveau.exemple.fr node tests/e2e/demenagement.mjs

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
