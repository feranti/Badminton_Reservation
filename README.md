# Badminton Résas

Application web pour un groupe d'amis qui joue au badminton :

- mettre en commun les soirées, les terrains réservés (6 à 14) et qui les a payés ;
- tenir les comptes en temps réel (qui doit combien à qui) ;
- signaler un remboursement, que le bénéficiaire confirme.

Technologies : [Next.js](https://nextjs.org) (TypeScript, Tailwind) pour le site, [Supabase](https://supabase.com) pour la base PostgreSQL, la connexion par e-mail et le temps réel, [Vercel](https://vercel.com) pour l'hébergement.

## Avancement

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Socle : projet Next.js, schéma de la base, connexion par lien e-mail | Fait |
| 2 | Soirées partagées : plusieurs terrains par soirée, inscription des joueurs, temps réel | Fait |
| 3 | Comptes en temps réel, liste « qui doit à qui », remboursements confirmés | À faire |
| 4 | Mise en ligne et invitation du groupe | À faire |

## Règles de calcul

- Une **soirée** regroupe un ou plusieurs **terrains** (numérotés de 6 à 14). Chaque terrain est réservé et payé par un joueur, qui avance son prix.
- Les joueurs s'inscrivent à la soirée, pas à un terrain.
- Le prix total des terrains de la soirée est partagé à parts égales entre les joueurs inscrits.
- Un remboursement compte dans les soldes une fois confirmé par celui qui le reçoit.
- Solde d'un joueur = ce qu'il a avancé − sa part des soirées + remboursements envoyés − remboursements reçus. Positif : on lui doit de l'argent.

Les montants sont stockés en centimes, les heures sont saisies et affichées à l'heure de Paris. Le calcul est fait par la vue `balances` (voir `supabase/migrations/0002_soirees.sql`).

## Mise en route

### 1. Créer le projet Supabase

1. Créez un compte et un projet gratuit sur [supabase.com](https://supabase.com) (région Europe, par exemple Paris ou Francfort).
2. Dans **SQL Editor**, exécutez l'un après l'autre le contenu de `supabase/migrations/0001_init.sql` puis de `supabase/migrations/0002_soirees.sql` (bouton « Raw » sur GitHub pour copier le fichier brut). Si vous aviez déjà exécuté `0001`, lancez seulement `0002`.
3. Dans **Authentication > Sign In / Providers**, désactivez **Allow new users to sign up** : seuls les amis invités pourront se connecter.
4. Dans **Authentication > URL Configuration**, mettez l'adresse du site dans **Site URL** (`http://localhost:3000` en local, puis l'adresse Vercel) et ajoutez-la aussi dans **Redirect URLs**.
5. Ajoutez les joueurs dans **Authentication > Users > Add user > Create new user**, en cochant **Auto Confirm User** (le mot de passe ne sert pas). Aucun e-mail n'est envoyé : chacun se connecte ensuite depuis la page de connexion du site.

Par défaut, le lien de connexion doit être ouvert dans le même navigateur que celui où on l'a demandé.

Pour plus tard (étape 4) : l'envoi d'e-mails intégré à Supabase est limité à quelques messages par heure, et les modèles d'e-mail ne sont modifiables qu'avec un service d'envoi à vous. Branchez un service SMTP gratuit (Resend, Brevo…) dans **Authentication > Emails > SMTP Settings**, puis remplacez le lien du modèle **Magic Link** par `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` : le lien marchera alors dans n'importe quel navigateur.

### 2. Lancer le site en local

Il faut Node.js 20 ou plus récent.

```bash
cp .env.example .env.local   # puis remplissez avec Project Settings > API de Supabase
npm install
npm run dev
```

Ouvrez http://localhost:3000, saisissez votre e-mail et cliquez sur le lien reçu.

Pour développer sans toucher au vrai projet, on peut aussi lancer une copie locale de Supabase avec Docker : `npx supabase start` applique les migrations, et les e-mails de connexion arrivent sur http://127.0.0.1:54324.

### 3. Mettre en ligne sur Vercel

1. Sur [vercel.com](https://vercel.com), importez ce dépôt GitHub.
2. Ajoutez les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Déployez, puis reportez l'adresse obtenue dans la configuration Supabase (étape 1.4).

## Structure

```
supabase/migrations/       Schéma de la base (tables, vue des soldes, règles d'accès, temps réel)
supabase/config.toml       Réglages de la copie locale de Supabase (npx supabase start)
src/proxy.ts               Rafraîchit la session et renvoie vers /login si besoin
src/lib/supabase/          Clients Supabase (navigateur, serveur, proxy)
src/lib/data.ts            Lecture des soirées, terrains et joueurs
src/lib/format.ts          Montants, dates et heure de Paris
src/lib/courts.ts          Numéros des terrains du gymnase
src/app/page.tsx           Accueil : soirées à venir ou passées
src/app/soirees/           Nouvelle soirée, détail d'une soirée et actions (ajout, inscription…)
src/app/profil/            Changer son nom affiché
src/app/login/             Connexion par lien e-mail
src/app/auth/confirm/      Arrivée du lien de connexion
src/components/            Éléments d'interface (carte de soirée, formulaires, temps réel)
```
