# Badminton Résas

Application web pour un groupe d'amis qui joue au badminton :

- mettre en commun qui a réservé quel terrain ;
- tenir les comptes en temps réel (qui doit combien à qui) ;
- signaler un remboursement, que le bénéficiaire confirme.

Technologies : [Next.js](https://nextjs.org) (TypeScript, Tailwind) pour le site, [Supabase](https://supabase.com) pour la base PostgreSQL, la connexion par e-mail et le temps réel, [Vercel](https://vercel.com) pour l'hébergement.

## Avancement

| Étape | Contenu | État |
| --- | --- | --- |
| 1 | Socle : projet Next.js, schéma de la base, connexion par lien e-mail | Fait |
| 2 | Réservations partagées : ajouter, voir, modifier, s'inscrire comme participant | À faire |
| 3 | Comptes en temps réel, liste « qui doit à qui », remboursements confirmés | À faire |
| 4 | Mise en ligne et invitation du groupe | À faire |

## Règles de calcul

- Le prix d'une réservation est avancé par la personne qui a réservé (`booked_by`).
- Il est partagé à parts égales entre les joueurs inscrits sur la réservation.
- Un remboursement compte dans les soldes une fois confirmé par celui qui le reçoit.
- Solde d'un joueur = ce qu'il a avancé − sa part des terrains + remboursements envoyés − remboursements reçus. Positif : on lui doit de l'argent.

Les montants sont stockés en centimes. Le calcul est fait par la vue `balances` (voir `supabase/migrations/0001_init.sql`).

## Mise en route

### 1. Créer le projet Supabase

1. Créez un compte et un projet gratuit sur [supabase.com](https://supabase.com) (région Europe, par exemple Paris ou Francfort).
2. Dans **SQL Editor**, collez et exécutez le contenu de `supabase/migrations/0001_init.sql`.
3. Dans **Authentication > Sign In / Providers**, désactivez **Allow new users to sign up** : seuls les amis invités pourront se connecter.
4. Dans **Authentication > URL Configuration**, mettez l'adresse du site dans **Site URL** (`http://localhost:3000` en local, puis l'adresse Vercel) et ajoutez-la aussi dans **Redirect URLs**.
5. Dans **Authentication > Emails**, modifiez deux modèles pour que le lien fonctionne même s'il s'ouvre dans un autre navigateur que celui de la demande :
   - **Magic Link** : remplacez le lien par `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - **Invite user** : remplacez le lien par `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
6. Invitez les joueurs dans **Authentication > Users > Add user > Send invitation**.

À savoir : sur l'offre gratuite, l'envoi d'e-mails par Supabase est limité à quelques messages par heure. Pour un groupe plus grand, branchez un service d'envoi (SMTP) dans **Authentication > Emails > SMTP Settings**.

### 2. Lancer le site en local

Il faut Node.js 20 ou plus récent.

```bash
cp .env.example .env.local   # puis remplissez avec Project Settings > API de Supabase
npm install
npm run dev
```

Ouvrez http://localhost:3000, saisissez votre e-mail et cliquez sur le lien reçu.

### 3. Mettre en ligne sur Vercel

1. Sur [vercel.com](https://vercel.com), importez ce dépôt GitHub.
2. Ajoutez les variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Déployez, puis reportez l'adresse obtenue dans la configuration Supabase (étape 1.4).

## Structure

```
supabase/migrations/   Schéma de la base (tables, vue des soldes, règles d'accès, temps réel)
src/proxy.ts           Rafraîchit la session et renvoie vers /login si besoin
src/lib/supabase/      Clients Supabase (navigateur, serveur, proxy)
src/lib/database.types.ts  Types TypeScript de la base
src/app/login/         Page de connexion par lien e-mail
src/app/auth/confirm/  Arrivée du lien de connexion
src/app/page.tsx       Accueil
```
