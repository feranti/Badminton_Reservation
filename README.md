# Badminton Résas

Application web pour un groupe d'amis qui joue au badminton :

- mettre en commun les sessions, les terrains réservés (6 à 14), qui les a payés et leurs QR codes ;
- s'inscrire à une session (4 joueurs par terrain), avec liste d'attente et e-mail quand une place se libère ;
- tenir les comptes en temps réel (qui doit combien à qui) ;
- signaler un remboursement, que le bénéficiaire confirme.

Technologies : [Next.js](https://nextjs.org) (TypeScript, Tailwind) pour le site, [Supabase](https://supabase.com) pour la base PostgreSQL, la connexion par e-mail et le temps réel, [Vercel](https://vercel.com) pour l'hébergement.

## Avancement

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Socle : projet Next.js, schéma de la base, connexion par lien e-mail | Fait |
| 2 | Sessions partagées : plusieurs terrains par session, inscription des joueurs, temps réel | Fait |
| 3 | Comptes en temps réel, liste « qui doit à qui », remboursements confirmés | Fait |
| 3b | Sessions regroupées par créneaux, QR codes, liste d'attente et e-mail de place libérée | Fait |
| 4 | Mise en ligne et invitation du groupe | À faire |

## Règles de calcul

- Une **réservation** = un terrain (6 à 14) sur un créneau. Elle est payée par un joueur, ou par deux (comme le permet le site du gymnase) : chacun avance alors la moitié du prix. On peut y joindre le QR code reçu par e-mail.
- Une **session** regroupe automatiquement les réservations d'un même gymnase dont les créneaux se suivent ou se chevauchent (par exemple 20:00 – 21:00 et 21:00 – 22:00). Une réservation à midi et une le soir font deux sessions.
- Les joueurs s'inscrivent à la session, pas à un terrain. Capacité : 4 joueurs par terrain différent. Au-delà, les inscrits sont en **liste d'attente**, dans l'ordre d'inscription.
- Quand un joueur se désiste (ou qu'un terrain est ajouté), le premier de la liste d'attente passe joueur et reçoit un e-mail.
- Le prix total des réservations de la session est partagé à parts égales entre les joueurs effectifs (pas la liste d'attente).
- Un remboursement compte dans les soldes une fois confirmé par celui qui le reçoit. S'il est signalé par celui qui reçoit l'argent, il est confirmé d'office.
- La page Comptes propose la liste de virements la plus courte pour remettre tout le monde à zéro.
- Solde d'un joueur = ce qu'il a avancé − sa part des soirées + remboursements envoyés − remboursements reçus. Positif : on lui doit de l'argent.

Les montants sont stockés en centimes, les heures sont saisies et affichées à l'heure de Paris. Le calcul est fait par la vue `balances` (voir `supabase/migrations/0007_sessions_creneaux.sql`).

## Mise en route

### 1. Créer le projet Supabase

1. Créez un compte et un projet gratuit sur [supabase.com](https://supabase.com) (région Europe, par exemple Paris ou Francfort).
2. Dans **SQL Editor**, exécutez l'un après l'autre le contenu de chaque fichier de `supabase/migrations/` dans l'ordre (`0001`, `0002`, `0003`…), avec le bouton « Raw » de GitHub pour copier le fichier brut. Ne relancez pas ceux déjà exécutés.
3. Dans **Authentication > Sign In / Providers**, désactivez **Allow new users to sign up** : seuls les amis invités pourront se connecter.
4. Dans **Authentication > URL Configuration**, mettez l'adresse du site dans **Site URL** (`http://localhost:3000` en local, puis l'adresse Vercel) et ajoutez-la aussi dans **Redirect URLs**.
5. Ajoutez les joueurs dans **Authentication > Users > Add user > Create new user**, en cochant **Auto Confirm User** (le mot de passe ne sert pas). Aucun e-mail n'est envoyé : chacun se connecte ensuite depuis la page de connexion du site.

Par défaut, le lien de connexion doit être ouvert dans le même navigateur que celui où on l'a demandé.

Pour plus tard (étape 4) : l'envoi d'e-mails intégré à Supabase est limité à quelques messages par heure, et les modèles d'e-mail ne sont modifiables qu'avec un service d'envoi à vous. Branchez un service SMTP (Gmail avec un mot de passe d'application, Resend, Brevo…) dans **Authentication > Emails > SMTP Settings**, puis collez le contenu de `supabase/templates/magic_link.html` dans le modèle **Magic Link** : l'e-mail contiendra un lien qui marche dans n'importe quel navigateur et un code à 6 chiffres à saisir dans l'appli (pratique depuis l'icône de l'écran d'accueil).

### 2. Lancer le site en local

Il faut Node.js 20 ou plus récent.

```bash
cp .env.example .env.local   # puis remplissez avec Project Settings > API de Supabase
npm install
npm run dev
```

Ouvrez http://localhost:3000, saisissez votre e-mail et cliquez sur le lien reçu.

Pour développer sans toucher au vrai projet, on peut aussi lancer une copie locale de Supabase avec Docker : `npx supabase start` applique les migrations, et les e-mails de connexion arrivent sur http://127.0.0.1:54324.

### E-mails de liste d'attente

Ils partent d'un compte Gmail avec un **mot de passe d'application** (Compte Google > Sécurité > Validation en deux étapes activée > Mots de passe des applications). Ajoutez dans `.env.local` (et sur Vercel) :

```
SUPABASE_SECRET_KEY=...    # Supabase > Project Settings > API Keys > Secret keys
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=votre.adresse@gmail.com
SMTP_PASS=...              # le mot de passe d'application, 16 lettres
MAIL_FROM=Badminton Résas <votre.adresse@gmail.com>
```

Sans ces variables, l'appli marche normalement mais n'envoie pas d'e-mail.

### 3. Mettre en ligne sur Vercel

1. Sur [vercel.com](https://vercel.com), importez ce dépôt GitHub.
2. Ajoutez les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, et celles des e-mails de liste d'attente (voir ci-dessous).
3. Déployez, puis reportez l'adresse obtenue dans la configuration Supabase (étape 1.4).

## Structure

```
supabase/migrations/       Schéma de la base (tables, vue des soldes, règles d'accès, temps réel)
supabase/config.toml       Réglages de la copie locale de Supabase (npx supabase start)
src/proxy.ts               Rafraîchit la session et renvoie vers /login si besoin
src/lib/supabase/          Clients Supabase (navigateur, serveur, proxy)
src/lib/data.ts            Lecture des sessions, réservations et joueurs
src/lib/notify.ts          E-mail aux joueurs qui sortent de la liste d'attente
src/lib/format.ts          Montants, dates et heure de Paris
src/lib/courts.ts          Numéros des terrains du gymnase
src/app/page.tsx           Accueil : sessions à venir ou passées
src/app/sessions/          Nouvelle réservation, détail d'une session et actions (ajout, inscription, QR code…)
src/app/comptes/           Soldes, « qui doit à qui », remboursements à signaler et confirmer
src/lib/settle.ts          Calcul des virements pour équilibrer les comptes
src/app/profil/            Changer son nom affiché
src/app/login/             Connexion par lien ou code reçu par e-mail
src/app/auth/confirm/      Arrivée du lien de connexion
src/components/            Éléments d'interface (carte de soirée, formulaires, temps réel)
```
