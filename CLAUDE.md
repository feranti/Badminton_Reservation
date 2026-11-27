# Badminton Résas : règles de travail

Lire aussi `AGENTS.md` (Next.js 16 : consulter `node_modules/next/dist/docs/` avant d'écrire du code).

## Avant chaque livraison

Lancer `npm run check` après toute modification de code ou de base, avant de committer et de pousser.
Le script (`scripts/check.sh`) fait lint, types, build de production, crée une base neuve dans un
Postgres 18 seul avec un Mailpit (Docker, `scripts/creer-base.sh`), joue le test de bout en bout à deux joueurs (`tests/e2e/run.mjs`) et ouvre
chaque page avec `next dev` en échouant si le serveur affiche une erreur.
Ne livrer que si tout est vert. Ajouter au test de bout en bout chaque nouvelle fonctionnalité.

Exception : une modification qui ne touche que la documentation (dossier `docs/`, images comprises,
ou fichiers `.md`) se passe de `npm run check`. Le check GitHub le reconnaît et passe sans rien lancer.

Dans le conteneur cloud, lancer `dockerd` s'il ne tourne pas, et passer
`CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`.

## Base de données

- La base tourne sur le VPS (Postgres 18), plus sur Supabase. Une base neuve se crée avec
  `scripts/creer-base.sh` : `supabase/socle.sql` (ce que les migrations attendent de Supabase),
  puis `supabase/migrations/0001_init.sql` (anciennes migrations 0001 à 0009 regroupées) et les
  suivantes. Toute modification de schéma passe par un nouveau fichier
  `supabase/migrations/NNNN_nom.sql` (ne jamais modifier une migration déjà appliquée) : le check
  le joue automatiquement. Les données de test sont à part, dans `supabase/donnees-test/`.
- Toute nouvelle table ou vue a besoin de RLS **et** de `grant` explicites pour `authenticated`
  (voir la partie « Droits de l'API » de `0001_init.sql`) ; le compte du site `resas_app` reçoit
  ses droits par défaut.
- Une migration s'exécute sur la base de production seulement avec l'accord écrit d'Antoine.
  Soit il la joue lui-même avec DBeaver, soit Claude la joue depuis son PC (voir ci-dessous).

## Exécuter du SQL sur la base de production

Une session cloud ne peut pas joindre le VPS : son proxy n'accepte que le HTTPS et coupe le SSH.
Il faut passer par le PC d'Antoine, via une session Remote Control dans le dossier
`D:\_PROJETS\PERSO\badminton_reservations` (son PC doit être allumé, avec l'application Claude ouverte).

- VPS : `root@2.25.6.228`, port 22, clé `C:\Users\ANTOINE_ASUS_ROG\.ssh\id_ed25519_hostinger`.
- Postgres 18 tourne dans un conteneur Docker Swarm (Dokploy) dont le nom commence par
  `badminton-bookings-badmintondb` (le suffixe change à chaque redéploiement : le retrouver avec
  `docker ps -qf name=badminton-bookings-badmintondb`). Port 5432 non publié.
- Utilisateur `postgres`, base `postgres` (schémas `public` et `auth`). Pas de mot de passe à
  fournir : on passe par le `psql` du conteneur. `psql` n'est pas installé sur le PC.
- Aucune table ne trace les migrations jouées : comparer le schéma réel aux fichiers avant d'en jouer une.
- DBeaver, pour mémoire : tunnel SSH vers le VPS, puis `127.0.0.1:5433` (relais `badminton-db-relais`).

Commandes testées dans PowerShell (chemin de clé avec des `/`, la partie entre apostrophes
s'exécute sur le VPS). Lecture :

```powershell
ssh -i C:/Users/ANTOINE_ASUS_ROG/.ssh/id_ed25519_hostinger -o BatchMode=yes root@2.25.6.228 'docker exec -i $(docker ps -qf name=badminton-bookings-badmintondb) psql -U postgres -d postgres -Atc "select version()"'
```

Fichier de migration : le copier sur le VPS (la redirection `<` n'existe pas dans PowerShell et
son pipe abîme les accents), puis le jouer en une seule transaction en s'arrêtant à la première erreur :

```powershell
scp -i C:/Users/ANTOINE_ASUS_ROG/.ssh/id_ed25519_hostinger -o BatchMode=yes supabase/migrations/NNNN_nom.sql root@2.25.6.228:/tmp/
ssh -i C:/Users/ANTOINE_ASUS_ROG/.ssh/id_ed25519_hostinger -o BatchMode=yes root@2.25.6.228 'docker exec -i $(docker ps -qf name=badminton-bookings-badmintondb) psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 < /tmp/NNNN_nom.sql && rm /tmp/NNNN_nom.sql'
```

Ces commandes sont autorisées sans confirmation par `.claude/settings.local.json` sur le PC
d'Antoine (fichier local, non versionné). L'accord écrit d'Antoine reste exigé avant toute écriture.

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
