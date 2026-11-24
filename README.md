# Badminton Résas

Application web pour un groupe d'amis qui joue au badminton :

- mettre en commun les sessions, les terrains réservés (6 à 14), qui les a payés et leurs QR codes ;
- s'inscrire à une session (4 joueurs par terrain), seul ou avec des invités sans compte (+1, +2…), avec liste d'attente et e-mail quand une place se libère ;
- prévenir le groupe WhatsApp des terrains réservés ou annulés et des inscriptions, rappeler 72h avant une session où il manque au moins 4 joueurs, et poster chaque lundi soir le récap des comptes ;
- tenir les comptes en temps réel (qui doit combien à qui), avec une page qui explique le calcul ;
- signaler un remboursement, que le bénéficiaire confirme.

Le site s'utilise surtout sur téléphone (icône sur l'écran d'accueil), en thème clair ou sombre.

Technologies : [Next.js](https://nextjs.org) (TypeScript, Tailwind) pour le site, [Supabase](https://supabase.com) pour la base PostgreSQL, un VPS avec [Dokploy](https://dokploy.com) (Docker) pour l'hébergement. Les e-mails de liste d'attente partent par SMTP (Gmail) et les messages au groupe WhatsApp par [Green API](https://green-api.com).

## Captures d'écran

Prises sur téléphone avec le jeu de données fictif (`supabase/donnees-test/`) : les joueurs et les montants sont inventés.

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/captures/accueil.png" alt="Accueil : solde et sessions à venir" width="240"><br><sub>Accueil : solde et sessions à venir</sub></td>
    <td align="center" width="33%"><img src="docs/captures/session.png" alt="Une session : terrains, joueurs, part de chacun" width="240"><br><sub>Une session : terrains, joueurs, part de chacun</sub></td>
    <td align="center" width="33%"><img src="docs/captures/liste-attente.png" alt="Session complète : liste d'attente" width="240"><br><sub>Session complète : liste d'attente</sub></td>
  </tr>
  <tr>
    <td align="center" width="33%"><img src="docs/captures/nouvelle-reservation.png" alt="Nouvelle réservation" width="240"><br><sub>Nouvelle réservation</sub></td>
    <td align="center" width="33%"><img src="docs/captures/gerer.png" alt="Gérer : terrains, payeurs, QR codes" width="240"><br><sub>Gérer : terrains, payeurs, QR codes</sub></td>
    <td align="center" width="33%"><img src="docs/captures/comptes.png" alt="Comptes : qui doit combien à qui" width="240"><br><sub>Comptes : qui doit combien à qui</sub></td>
  </tr>
  <tr>
    <td align="center" width="33%"><img src="docs/captures/calcul.png" alt="Explication du calcul" width="240"><br><sub>Explication du calcul</sub></td>
    <td align="center" width="33%"><img src="docs/captures/accueil-sombre.png" alt="Accueil en thème sombre" width="240"><br><sub>Accueil en thème sombre</sub></td>
    <td align="center" width="33%"><img src="docs/captures/comptes-sombre.png" alt="Comptes en thème sombre" width="240"><br><sub>Comptes en thème sombre</sub></td>
  </tr>
</table>

## Architecture

![Architecture : les joueurs, le site sur le VPS, Supabase, Gmail, Green API, GitHub et GHCR](docs/architecture.svg)

- Le **VPS** héberge le site Next.js dans un conteneur Docker, géré par Dokploy, derrière Traefik (HTTPS). Les pages sont rendues sur le serveur et les formulaires passent par des Server Actions, qui envoient aussi les e-mails et les messages WhatsApp.
- **Supabase** fournit la base Postgres, avec les règles d'accès par joueur (RLS). La connexion par lien ou code e-mail est gérée par le site lui-même (`src/lib/auth.ts`) : l'e-mail part par SMTP, et la session est un cookie dont la base garde l'empreinte (tables `login_tokens` et `auth_sessions`). Le serveur interroge la base directement en SQL (`DATABASE_URL`), au nom du joueur connecté, pour que les règles d'accès s'appliquent. Les images des QR codes sont gardées dans la base (table `qr_images`), et le temps réel passe aussi par elle : chaque modification envoie un signal (`pg_notify`) que le serveur relaie aux pages ouvertes (`/api/changements`).
- Le **navigateur** ne parle qu'au site, jamais directement à Supabase.
- **Gmail (SMTP)** envoie les e-mails de connexion et « une place s'est libérée ». **Green API** envoie au groupe WhatsApp les terrains réservés ou annulés.
- **GitHub** garde le code, construit l'image Docker à chaque push sur `main`, la publie sur GHCR et demande à Dokploy de la déployer.

## Règles de calcul

- Une **réservation** = un terrain (6 à 14) sur un créneau. Elle est payée par un joueur, ou par deux (comme le permet le site du gymnase) : chacun avance alors la moitié du prix. On peut y joindre le QR code reçu par e-mail, et corriger son prix après coup dans « Gérer » (les comptes sont recalculés).
- Une **session** regroupe automatiquement les réservations d'un même gymnase dont les créneaux se suivent ou se chevauchent (par exemple 20:00 – 21:00 et 21:00 – 22:00). Une réservation à midi et une le soir font deux sessions.
- Les joueurs s'inscrivent à la session, pas à un terrain. Capacité : 4 places par terrain différent. Au-delà, les inscrits sont en **liste d'attente**, dans l'ordre d'inscription. Ceux qui paient une réservation y sont inscrits d'office.
- Un inscrit peut amener des **invités** sans compte : chacun prend une place, et l'inscrit paie leur part. Un inscrit et ses invités jouent ensemble ou attendent ensemble.
- Quand un joueur se désiste (ou qu'un terrain est ajouté), le premier de la liste d'attente passe joueur et reçoit un e-mail.
- Le prix total des réservations de la session est partagé à parts égales entre les places des joueurs effectifs, invités compris (pas la liste d'attente).
- Un remboursement compte dans les soldes une fois confirmé par celui qui le reçoit. S'il est signalé par celui qui reçoit l'argent, il est confirmé d'office.
- La page Comptes propose la liste de virements la plus courte pour remettre tout le monde à zéro.
- Solde d'un joueur = ce qu'il a avancé − sa part des soirées + remboursements envoyés − remboursements reçus. Positif : on lui doit de l'argent.

Les montants sont stockés en centimes, les heures sont saisies et affichées à l'heure de Paris. Le calcul est fait par la vue `balances` (voir `supabase/migrations/0001_init.sql`), et expliqué aux joueurs sur la page Comptes > « Comment sont calculés les comptes ? ».

## Mise en route

### 1. Créer le projet Supabase

1. Créez un compte et un projet gratuit sur [supabase.com](https://supabase.com) (région Europe, par exemple Paris ou Francfort).
2. Dans **SQL Editor**, collez et exécutez le contenu de `supabase/migrations/0001_init.sql` (bouton « Raw » de GitHub pour copier le fichier brut). Ce seul script crée toute la base : tables, vues des soldes et de la liste d'attente, règles d'accès, droits, stockage des QR codes et temps réel. Il ne s'exécute qu'une fois, sur un projet neuf. Si d'autres fichiers `0002_…`, `0003_…` existent un jour dans `supabase/migrations/`, exécutez-les ensuite dans l'ordre.
3. Dans **Authentication > Sign In / Providers**, désactivez **Allow new users to sign up** : seuls les amis invités pourront se connecter.
4. Dans **Authentication > URL Configuration**, mettez l'adresse du site dans **Site URL** (`http://localhost:3000` en local, puis l'adresse du site en ligne) et ajoutez-la aussi dans **Redirect URLs**.
5. Ajoutez les joueurs dans **Authentication > Users > Add user > Create new user**, en cochant **Auto Confirm User** (le mot de passe ne sert pas). Aucun e-mail n'est envoyé : chacun se connecte ensuite depuis la page de connexion du site.

Par défaut, le lien de connexion doit être ouvert dans le même navigateur que celui où on l'a demandé.

### Données de test (facultatif)

Pour essayer l'appli avec des sessions déjà remplies, exécutez `supabase/donnees-test/remplir.sql` dans **SQL Editor** : il ajoute 8 joueurs fictifs (qui ne peuvent pas se connecter), 9 sessions passées et à venir et quelques remboursements. Votre compte (le plus ancien du projet) y joue le rôle de « vous ». Tout est marqué `(test)` ou `[TEST]`, et `supabase/donnees-test/vider.sql` efface tout sans toucher aux vraies données.

Pour inviter le groupe : un joueur ne peut se connecter que s'il existe déjà. Ajoutez chaque adresse dans **Authentication > Users > Add user** de Supabase (« Create new user », sans mot de passe, « Auto Confirm User » coché). L'e-mail de connexion part du SMTP du site (voir « E-mails » plus bas) : un lien et un code de 8 chiffres, valables une heure.

### 2. Lancer le site en local

Il faut Node.js 20 ou plus récent.

```bash
# créez .env.local avec NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Project Settings > API de Supabase)
# et DATABASE_URL (voir « Connexion à la base » ci-dessous)
npm install
npm run dev
```

Ouvrez http://localhost:3000, saisissez votre e-mail et cliquez sur le lien reçu.

Pour développer sans toucher au vrai projet, on peut aussi lancer une copie locale de Supabase avec Docker : `npx supabase start` crée la base avec `supabase/migrations/`, et les e-mails de connexion arrivent sur http://127.0.0.1:54324.

### Connexion à la base

Le serveur lit et écrit la base directement en SQL (`src/lib/db.ts`), sans passer par l'API de Supabase.
Chaque requête d'un joueur s'exécute avec son identifiant et le rôle `authenticated` : les règles d'accès (RLS),
les fonctions et l'historique de la base marchent exactement comme avant. Les tâches planifiées et l'envoi
des e-mails de liste d'attente utilisent la même connexion, sans joueur.

Ajoutez dans `.env.local` (et dans les variables du site sur Dokploy) l'adresse de connexion, à prendre dans
Supabase > bouton **Connect** en haut de la page du projet > **Session pooler** (le VPS n'a pas besoin d'IPv6
avec cette adresse), en remplaçant `[YOUR-PASSWORD]` par le mot de passe de la base :

```
DATABASE_URL=postgresql://postgres.<id du projet>:<mot de passe>@aws-0-<région>.pooler.supabase.com:5432/postgres
```

Le mot de passe se réinitialise dans Supabase > Project Settings > Database si vous ne l'avez plus.

La connexion est toujours chiffrée (TLS) vers une base distante. Pour que le site vérifie aussi qu'il parle bien
à Supabase, téléchargez le certificat dans Project Settings > Database > **SSL Configuration** et collez son contenu
dans la variable `DATABASE_CA_CERT` (les retours à la ligne peuvent être écrits `\n`). Dans la même page, activez
**Enforce SSL on incoming connections** pour refuser toute connexion non chiffrée.
Avec la copie locale (`npx supabase start`) : `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

### Vérifier avant de livrer

`npm run check` (Docker et Node.js requis) enchaîne le lint, les types, le build de production, remet à zéro la copie locale de Supabase, joue un test de bout en bout à deux joueurs (`tests/e2e/run.mjs`) et ouvre chaque page avec `next dev` en échouant au moindre message d'erreur.

### E-mails (connexion et liste d'attente)

Ils partent d'un compte Gmail avec un **mot de passe d'application** (Compte Google > Sécurité > Validation en deux étapes activée > Mots de passe des applications). Ajoutez dans `.env.local` (et dans les variables du site sur Dokploy) :

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=votre.adresse@gmail.com
SMTP_PASS=...              # le mot de passe d'application, 16 lettres
MAIL_FROM=Badminton Résas <votre.adresse@gmail.com>
```

Ces variables sont **indispensables en ligne** : sans elles, aucun e-mail de connexion ne part (en local, le lien et le code sont alors écrits dans le journal du serveur).

### Messages au groupe WhatsApp

Chaque terrain réservé ou annulé, chaque inscription (avec ses invités) et chaque session supprimée envoie un message au groupe WhatsApp du club
(créneau, gymnase, terrains, places restantes et lien vers la session). Rien n'est envoyé pour une session déjà passée.
L'envoi passe par [Green API](https://green-api.com), qui garde la connexion d'un numéro WhatsApp (de préférence
un numéro dédié, membre du groupe) : l'appli n'a rien à héberger.

1. Sur green-api.com, créez une instance (l'offre gratuite Developer suffit) et scannez son QR code avec le WhatsApp du numéro.
2. Récupérez l'identifiant du groupe (`...@g.us`), par exemple avec la méthode `getChats` de Green API.
3. Ajoutez dans `.env.local` (et dans les variables du site sur Dokploy) :

```
GREEN_API_URL=https://7105.api.greenapi.com   # « apiUrl » affiché sur la page de l'instance
GREEN_API_INSTANCE=7105000000                 # idInstance
GREEN_API_TOKEN=...                           # apiTokenInstance
WHATSAPP_GROUP_ID=120363000000000000@g.us
```

Sans ces variables, les messages sont seulement écrits dans le journal du serveur.

### Rappel des terrains vides à 72h

Toutes les 6 heures, GitHub Actions (`.github/workflows/rappel-terrains-vides.yml`) appelle la route
`/api/cron/rappel-terrains-vides`. Pour chaque session qui commence dans 48 à 72h, s'il manque au moins
4 joueurs (un terrain entier vide), le groupe WhatsApp reçoit un rappel, une seule fois : les oubliés peuvent
s'inscrire, ou le groupe décide de jouer en simple ou d'annuler un terrain (au Prisme, au plus tard 48h avant).

### Tâches planifiées toujours actives

GitHub désactive les tâches planifiées d'un dépôt resté 60 jours sans commit. Chaque dimanche,
`.github/workflows/garder-actif.yml` les réactive par l'API (lui compris), ce qui remet ce délai à zéro.
Ces tâches gardent aussi le projet Supabase gratuit éveillé, puisque le rappel des terrains vides interroge
la base toutes les 6 heures.

1. Dans les variables du site sur Dokploy, ajoutez `CRON_SECRET` (une longue valeur au hasard) et `APP_URL` (adresse publique du site, utilisée pour les liens des messages).
2. Sur GitHub, dans Settings > Secrets and variables > Actions, créez le secret `CRON_SECRET` avec la même valeur, et dans l'onglet **Variables** la variable `APP_URL` (adresse du site appelée par les workflows).
3. Exécutez `supabase/migrations/0006_rappel_terrains_vides.sql` sur le projet en ligne.

### Récap hebdomadaire des comptes

Chaque **lundi à 23 h** (heure de Paris), l'appli poste dans le groupe la liste des remboursements à faire pour
remettre tout le monde à zéro (la même que la page Comptes), en signalant ceux déjà déclarés et pas encore confirmés,
avec le lien vers la page Comptes. Quand personne ne doit rien, le message dit que tout le monde est à jour.

Le workflow GitHub Actions `.github/workflows/recap-comptes.yml` appelle `/api/cron/recap-comptes`
(GitHub gère le passage à l'heure d'été). Il faut :

- dans les variables du site sur Dokploy : `CRON_SECRET` (une longue chaîne au hasard) et `APP_URL` ;
- sur GitHub (Settings > Secrets and variables > Actions) : le secret `CRON_SECRET`, la même valeur, et la variable `APP_URL` ;
- le script `supabase/migrations/0004_recap_comptes.sql` exécuté sur le projet en ligne.

Pour envoyer le récap tout de suite : onglet **Actions** > « Récap des comptes » > **Run workflow**.

### 3. Mettre en ligne sur le VPS (Dokploy)

Le site est construit par le `Dockerfile` (serveur Next.js autonome, `output: "standalone"`). L'image n'est pas construite sur le VPS : à chaque push sur `main`, le workflow `.github/workflows/deploy.yml` la construit sur GitHub, la publie sur GHCR (`ghcr.io/feranti/badminton_reservation`, étiquettes `latest` et `sha-<commit>`), demande à Dokploy de la déployer et ne garde que les 10 dernières versions.

1. Sur GitHub (Settings > Secrets and variables > Actions), ajoutez les **variables** `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` : elles sont inscrites dans le JavaScript au moment du build.
2. Le paquet GHCR reste privé : créez un jeton GitHub classique (Settings > Developer settings > Personal access tokens > Tokens (classic)) avec la seule permission `read:packages`.
3. Dans Dokploy, créez une application avec la source **Docker** : image `ghcr.io/feranti/badminton_reservation:latest`, registre `ghcr.io`, utilisateur `feranti`, mot de passe = ce jeton. Laissez **Auto Deploy** activé (le webhook en a besoin).
4. Dans **Environment**, ajoutez `DATABASE_URL` (voir « Connexion à la base »), `APP_URL` (adresse publique du site, par exemple `https://bad-resas.feranti.dev` : les liens de l'e-mail de connexion et des messages WhatsApp sont construits avec elle, jamais avec les en-têtes de la requête) et les variables des e-mails de liste d'attente, de WhatsApp et des tâches planifiées si vous les utilisez (voir ci-dessus). Les `NEXT_PUBLIC_*` n'y servent à rien : elles sont déjà dans l'image.
5. Dans **Domains**, ajoutez le domaine du site, port `3000`, avec HTTPS (Let's Encrypt).
6. Copiez la **Webhook URL** de l'onglet **Deployments** dans le secret GitHub `DOKPLOY_WEBHOOK_URL`, déployez, puis reportez l'adresse dans la configuration Supabase (étape 1.4) et dans la variable GitHub `APP_URL`.

Pour revenir à une version précédente : dans Dokploy, remplacez `latest` par l'étiquette `sha-<commit>` voulue et redéployez.

Pour essayer l'image en local : `docker build -t bad-resas --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .` puis `docker run -p 3000:3000 --env-file .env.local bad-resas`.

## Base sur le VPS

La base peut quitter Supabase pour un Postgres 17 dans Dokploy, sur le même VPS que le site. Le script `scripts/vps/copier-base.sh` recopie tout (joueurs, sessions, comptes, historique, QR codes, sessions de connexion) et crée le compte du site, `resas_app`, qui lit et écrit les données sans pouvoir modifier le schéma ni devenir superutilisateur. `npm run check` le rejoue à chaque livraison sur un Postgres neuf.

### Bascule (une fois)

Les modifications faites sur l'ancien site entre la copie et la fin de la bascule seraient perdues : faites-la à un moment calme, en 15 minutes.

1. **Dokploy** : Create Service > Database > PostgreSQL, version 17, nom `badminton-db`, un mot de passe long. Ne remplissez pas « External Port » : la base reste invisible d'Internet. Notez l'**Internal Host** (onglet General) et le mot de passe.
2. Ouvrez, avant la copie, chaque QR code des sessions à venir sur le site : les images envoyées avant le 22 novembre sont alors recopiées de Supabase dans la base.
3. **Sur le VPS** (SSH) :
   ```sh
   mkdir -p ~/bascule && cd ~/bascule
   curl -fsSLO https://raw.githubusercontent.com/feranti/Badminton_Reservation/main/scripts/vps/copier-base.sh
   nano copie.env      # trois lignes, sans guillemets (voir ci-dessous)
   docker run --rm -i --network dokploy-network --env-file copie.env postgres:17 bash -s < copier-base.sh
   ```
   Contenu de `copie.env` :
   ```
   SOURCE_URL=postgresql://postgres.xxx:MOT_DE_PASSE_SUPABASE@aws-….pooler.supabase.com:5432/postgres
   TARGET_URL=postgresql://postgres:MOT_DE_PASSE_DOKPLOY@INTERNAL_HOST:5432/postgres
   APP_PASSWORD=une-longue-valeur-au-hasard-de-32-caracteres-ou-plus
   ```
   (`SOURCE_URL` est la `DATABASE_URL` actuelle du site ; `openssl rand -hex 24` donne un bon `APP_PASSWORD`.) Le script se termine par le nombre de lignes de chaque table, identique des deux côtés. Il refuse de remplir une base qui n'est pas vide.
4. **Dokploy**, variables du site : `DATABASE_URL=postgresql://resas_app:APP_PASSWORD@INTERNAL_HOST:5432/postgres`, supprimez `DATABASE_CA_CERT` s'il existe, puis **Deploy**.
5. Effacez le fichier : `shred -u ~/bascule/copie.env`.
6. **GitHub** (Settings > Secrets and variables > Actions > Variables) : `APP_URL` = l'adresse du site sur le VPS, pour que les tâches planifiées l'appellent. Puis, dans le projet Vercel, ajoutez la variable `NOUVEAU_SITE` = l'adresse du site sur le VPS (par exemple `https://bad-resas.feranti.dev`) et redéployez : l'ancien site affiche alors sur chaque page un message de déménagement et renvoie au même chemin sur le nouveau site, sans plus toucher à Supabase (`src/lib/demenagement.ts`). Mettez le projet Vercel en pause quand l'ancienne adresse peut fermer.

Supabase n'est que lu par le script : en cas de problème, remettre l'ancienne `DATABASE_URL` dans Dokploy suffit à revenir en arrière. Gardez le projet Supabase quelques semaines au cas où, puis supprimez-le : c'est une copie qui vieillit, avec les adresses des joueurs. Après la copie, changez aussi le mot de passe de sa base et supprimez sa clé secrète (`SUPABASE_SECRET_KEY`), puis retirez cette variable de Dokploy et, une fois `NOUVEAU_SITE` posé, les secrets du projet Vercel (`DATABASE_URL`, `SMTP_PASS`, `CRON_SECRET`, `GREEN_API_TOKEN`, `SUPABASE_SECRET_KEY`). Dans Dokploy, la base ne doit pas avoir d'« External Port » : seul le site et le relais local ci-dessous la joignent.

### Ouvrir la base avec DBeaver

La base n'est pas exposée sur Internet : DBeaver passe par SSH.

1. Sur le VPS, ouvrez un relais local vers la base (il ne répond que sur la machine elle-même) :
   ```sh
   docker run -d --name badminton-db-relais --restart unless-stopped --network dokploy-network \
     -p 127.0.0.1:5433:5432 alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:INTERNAL_HOST:5432
   ```
2. Dans DBeaver : New Database Connection > PostgreSQL. Onglet **SSH** : cochez « Use SSH Tunnel », hôte du VPS, votre utilisateur et votre clé SSH. Onglet **Main** : Host `localhost`, Port `5433`, Database `postgres`, utilisateur `postgres` et le mot de passe de Dokploy.

Ajouter un joueur : `insert into auth.users (email) values ('nom@exemple.fr');` (son profil est créé automatiquement, avec le début de l'adresse comme nom). Retirer un joueur : `update auth.users set banned_until = 'infinity' where email = 'nom@exemple.fr';` : il ne peut plus demander d'e-mail de connexion, et ses sessions ouvertes ne valent plus rien (ses réservations et ses comptes restent). Une nouvelle migration `supabase/migrations/NNNN_….sql` s'exécute de la même façon, en `postgres`.

## Modifier la base

La base d'un projet neuf est créée par le seul script `supabase/migrations/0001_init.sql` (il regroupe les anciennes migrations 0001 à 0009). Pour toute modification ultérieure, ajoutez un nouveau fichier `supabase/migrations/0002_nom.sql` (puis `0003`…) sans retoucher les précédents, exécutez-le dans **SQL Editor** du projet en ligne, et pensez aux règles RLS et aux `grant` pour `authenticated` de toute nouvelle table : le projet en ligne n'ouvre pas les tables à l'API par défaut.

## Structure

```
supabase/migrations/       0001_init.sql : création complète de la base (tables, vues, règles d'accès, droits, temps réel)
supabase/donnees-test/     Jeu de données factice : remplir.sql et vider.sql
supabase/config.toml       Réglages de la copie locale de Supabase (npx supabase start)
scripts/check.sh           Vérification complète avant livraison (npm run check)
tests/e2e/                 Test de bout en bout à deux joueurs et visite de toutes les pages
src/proxy.ts               Renvoie vers /login sans session
src/lib/app-url.ts         Adresse publique du site (APP_URL) pour les liens des e-mails et de WhatsApp
src/lib/rate-limit.ts      Limites par adresse IP de la page de connexion
src/lib/auth.ts            Connexion par e-mail : lien, code et sessions
scripts/vps/copier-base.sh Copie de la base Supabase vers le Postgres du VPS (bascule)
src/lib/data.ts            Lecture des sessions, réservations et joueurs
src/lib/notify.ts          E-mail aux joueurs qui sortent de la liste d'attente
src/lib/whatsapp.ts        Envoi d'un message au groupe WhatsApp par Green API
src/lib/format.ts          Montants, dates et heure de Paris
src/lib/courts.ts          Numéros des terrains du gymnase
src/app/page.tsx           Accueil : sessions à venir ou passées
src/app/sessions/          Nouvelle réservation, détail d'une session, page Gérer et actions (ajout, inscription, invités, QR code…)
src/app/comptes/           Soldes, « qui doit à qui », remboursements à signaler et confirmer, page d'aide sur le calcul
src/lib/settle.ts          Calcul des virements pour équilibrer les comptes
src/app/profil/            Changer son nom affiché et le thème (clair, sombre ou celui du téléphone)
src/app/login/             Connexion par lien ou code reçu par e-mail
src/app/auth/confirm/      Arrivée du lien de connexion
docs/architecture.svg      Schéma de l'architecture (ci-dessus)
docs/captures/             Captures d'écran du README
src/components/            Éléments d'interface (carte de soirée, formulaires, temps réel)
```
