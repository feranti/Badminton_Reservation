# Badminton Résas : règles de travail

Lire aussi `AGENTS.md` (Next.js 16 : consulter `node_modules/next/dist/docs/` avant d'écrire du code).

## Avant chaque livraison

Lancer `npm run check` après toute modification de code ou de base, avant de committer et de pousser.
Le script (`scripts/check.sh`) fait lint, types, build de production, crée une base neuve dans un
Postgres 17 seul avec un Mailpit (Docker, `scripts/creer-base.sh`), joue le test de bout en bout à deux joueurs (`tests/e2e/run.mjs`) et ouvre
chaque page avec `next dev` en échouant si le serveur affiche une erreur.
Ne livrer que si tout est vert. Ajouter au test de bout en bout chaque nouvelle fonctionnalité.

Dans le conteneur cloud, lancer `dockerd` s'il ne tourne pas, et passer
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.

## Base de données

- La base tourne sur le VPS (Postgres 17), plus sur Supabase. Une base neuve se crée avec
  `scripts/creer-base.sh` : `supabase/socle.sql` (ce que les migrations attendent de Supabase),
  puis `supabase/migrations/0001_init.sql` (anciennes migrations 0001 à 0009 regroupées) et les
  suivantes. Toute modification de schéma passe par un nouveau fichier
  `supabase/migrations/NNNN_nom.sql` (ne jamais modifier une migration déjà appliquée) : le check
  le joue automatiquement. Les données de test sont à part, dans `supabase/donnees-test/`.
- Toute nouvelle table ou vue a besoin de RLS **et** de `grant` explicites pour `authenticated`
  (voir la partie « Droits de l'API » de `0001_init.sql`) ; le compte du site `resas_app` reçoit
  ses droits par défaut.
- Donner le fichier de migration à Antoine pour qu'il l'exécute en `postgres` avec DBeaver.

## Pièges connus

- Avec `cacheComponents`, une page qui lit l'heure ou la base doit attendre la requête :
  `requirePlayer()` appelle `connection()` en premier.
- Les heures sont saisies et affichées à l'heure de Paris (`src/lib/format.ts`), jamais dans le
  fuseau du navigateur ou du serveur.
- Le serveur interroge la base en SQL avec `db` de `requirePlayer()` (`src/lib/db.ts`), jamais par une API :
  chaque requête porte l'identifiant du joueur, donc les règles RLS
  s'appliquent. `adminDb` (sans RLS) est réservé aux tâches planifiées, aux e-mails et à la connexion.
- La connexion est gérée par le site (`src/lib/auth.ts`), plus par Supabase Auth : l'e-mail de connexion part par le SMTP du site (au plus un par minute et par adresse), et les tables `login_tokens` et `auth_sessions` ne sont lisibles que par le serveur.
- Un lien envoyé hors du site (e-mail, WhatsApp) ou une redirection absolue part de `appOrigin()`
  (`src/lib/app-url.ts`, c'est-à-dire `APP_URL`), jamais des en-têtes `Origin`, `Host` ou
  `X-Forwarded-Host` : celui qui envoie la requête les choisit.
- Les formulaires utilisent `useFormAction` pour ne pas perdre la saisie en cas d'erreur.
