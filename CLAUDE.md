# Badminton Résas : règles de travail

Lire aussi `AGENTS.md` (Next.js 16 : consulter `node_modules/next/dist/docs/` avant d'écrire du code).

## Avant chaque livraison

Lancer `npm run check` après toute modification de code ou de base, avant de committer et de pousser.
Le script (`scripts/check.sh`) fait lint, types, build de production, remet à zéro une copie locale
de Supabase (Docker), joue le test de bout en bout à deux joueurs (`tests/e2e/run.mjs`) et ouvre
chaque page avec `next dev` en échouant si le serveur affiche une erreur.
Ne livrer que si tout est vert. Ajouter au test de bout en bout chaque nouvelle fonctionnalité.

Dans le conteneur cloud, lancer `dockerd` s'il ne tourne pas, et passer
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.

## Base de données

- La base est créée par un seul script, `supabase/migrations/0001_init.sql` (anciennes migrations
  0001 à 0009 regroupées). Toute modification de schéma passe par un nouveau fichier
  `supabase/migrations/NNNN_nom.sql` à partir de `0002` (ne jamais modifier une migration déjà
  appliquée). Les données de test sont à part, dans `supabase/donnees-test/`.
- Toute nouvelle table ou vue a besoin de RLS **et** de `grant` explicites pour `authenticated` :
  le projet en ligne n'ouvre pas les tables à l'API par défaut (voir la partie « Droits de l'API » de `0001_init.sql`).
- Appliquer ensuite la migration au projet en ligne « Badminton Reservations »
  (`yiwhkzxafkpadmvxqwhe`) avec le connecteur Supabase. Si la demande de validation n'aboutit pas,
  donner le fichier à Antoine pour qu'il l'exécute dans le SQL Editor.
- Après une migration, vérifier les avis de sécurité Supabase (advisors).

## Pièges connus

- Avec `cacheComponents`, une page qui lit l'heure ou appelle Supabase doit attendre la requête :
  `requirePlayer()` appelle `connection()` en premier.
- Les heures sont saisies et affichées à l'heure de Paris (`src/lib/format.ts`), jamais dans le
  fuseau du navigateur ou du serveur.
- Le temps réel a besoin du jeton du joueur avant l'abonnement (`src/components/realtime-refresh.tsx`).
- Les formulaires utilisent `useFormAction` pour ne pas perdre la saisie en cas d'erreur.
