import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { adminDb } from "@/lib/db";

// Connexion par e-mail gérée par le site (tables login_tokens et auth_sessions, migration 0012).
//
// - Un e-mail contient un lien et un code de 8 chiffres, valables une heure et une seule fois.
//   Seule leur empreinte (SHA-256) est en base : une copie de la base ne permet pas de se connecter.
// - Le code accepte 5 essais ; un nouvel e-mail annule le précédent ; au plus un e-mail par
//   minute et 5 par heure pour une même adresse, et 30 par heure en tout (le quota d'envoi de
//   Gmail reste ainsi disponible pour les vrais joueurs). Limites par adresse IP en plus :
//   src/app/login/actions.ts.
// - La session est un jeton aléatoire de 256 bits dans un cookie httpOnly ; la base en garde
//   l'empreinte. Elle expire après 90 jours sans visite, et ne vaut plus rien dès que le joueur
//   est banni (banned_until) ou supprimé (deleted_at).

export const SESSION_COOKIE = "resas_session";
const LOGIN_TTL = "1 hour";
const SESSION_DAYS = 90;
const MAX_CODE_ATTEMPTS = 5;
const MAX_MAILS_PER_HOUR = 30;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");

export type LoginRequest =
  | { ok: true; email: string; link: string; code: string }
  | { ok: false; reason: "unknown" | "too-soon" | "too-many" | "busy" };

// Prépare un e-mail de connexion pour un joueur existant (pas d'inscription libre).
export async function createLoginRequest(rawEmail: string, origin: string): Promise<LoginRequest> {
  const email = rawEmail.trim().toLowerCase();
  const linkToken = randomToken();
  const code = String(randomInt(0, 100_000_000)).padStart(8, "0");

  return adminDb.tx(async (tx) => {
    const [user] = await tx<{ id: string; email: string }[]>`
      select id, email from auth.users
      where lower(email) = ${email} and deleted_at is null and (banned_until is null or banned_until < now())`;
    if (!user) return { ok: false, reason: "unknown" } as const;

    // Verrou par joueur : deux demandes simultanées ne passent pas toutes les deux les limites.
    await tx`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;
    const [recent] = await tx<{ last_minute: number; last_hour: number }[]>`
      select count(*) filter (where created_at > now() - interval '1 minute') as last_minute,
             count(*) filter (where created_at > now() - interval '1 hour') as last_hour
      from public.login_tokens where user_id = ${user.id}`;
    if (recent.last_minute > 0) return { ok: false, reason: "too-soon" } as const;
    if (recent.last_hour >= 5) return { ok: false, reason: "too-many" } as const;
    // Limite totale : quelqu'un qui connaît les adresses des joueurs ne peut pas épuiser le quota
    // d'envoi du SMTP (Gmail bloque le compte pour la journée au-delà d'environ 500 e-mails).
    const [all] = await tx<{ last_hour: number }[]>`
      select count(*) as last_hour from public.login_tokens where created_at > now() - interval '1 hour'`;
    if (all.last_hour >= MAX_MAILS_PER_HOUR) return { ok: false, reason: "busy" } as const;

    await tx`update public.login_tokens set used_at = now() where user_id = ${user.id} and used_at is null`;
    const [row] = await tx<{ id: string }[]>`
      insert into public.login_tokens (user_id, link_hash, code_hash, expires_at)
      values (${user.id}, ${sha256(linkToken)}, '', now() + ${LOGIN_TTL}::interval)
      returning id`;
    // Le code est haché avec l'identifiant de la demande : deux demandes au même code n'ont pas la même empreinte.
    await tx`update public.login_tokens set code_hash = ${sha256(`${row.id}:${code}`)} where id = ${row.id}`;
    return { ok: true, email: user.email, link: `${origin}/auth/confirm?jeton=${linkToken}`, code } as const;
  });
}

// Lien de l'e-mail : renvoie le joueur, ou null si le lien est inconnu, expiré ou déjà utilisé.
export async function consumeLoginLink(linkToken: string) {
  if (!/^[\w-]{43}$/.test(linkToken)) return null;
  const [row] = await adminDb<{ user_id: string }>`
    update public.login_tokens set used_at = now()
    where link_hash = ${sha256(linkToken)} and used_at is null and expires_at > now()
    returning user_id`;
  return row?.user_id ?? null;
}

// Code saisi dans l'appli : compare avec la dernière demande encore valable du joueur.
export async function consumeLoginCode(rawEmail: string, code: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^\d{8}$/.test(code)) return null;
  return adminDb.tx(async (tx) => {
    const [row] = await tx<{ id: string; user_id: string; code_hash: string }[]>`
      update public.login_tokens t set attempts = attempts + 1
      from auth.users u
      where t.id = (
          select id from public.login_tokens
          where user_id = u.id and used_at is null and expires_at > now()
          order by created_at desc limit 1
        )
        and lower(u.email) = ${email} and t.attempts < ${MAX_CODE_ATTEMPTS}
      returning t.id, t.user_id, t.code_hash`;
    if (!row) return null;
    const expected = Buffer.from(row.code_hash, "hex");
    const given = Buffer.from(sha256(`${row.id}:${code}`), "hex");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    await tx`update public.login_tokens set used_at = now() where id = ${row.id}`;
    return row.user_id;
  });
}

// Ouvre une session : renvoie le jeton à mettre dans le cookie.
export async function createSession(userId: string) {
  const token = randomToken();
  await adminDb`
    insert into public.auth_sessions (token_hash, user_id, expires_at)
    values (${sha256(token)}, ${userId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  return token;
}

// Joueur de la session, ou null. Prolonge la session au plus une fois par jour.
export async function sessionUser(token: string | undefined) {
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const hash = sha256(token);
  const [row] = await adminDb<{ user_id: string }>`
    with prolonge as (
      update public.auth_sessions
      set last_seen_at = now(), expires_at = now() + ${`${SESSION_DAYS} days`}::interval
      where token_hash = ${hash} and expires_at > now() and last_seen_at < now() - interval '1 day'
    )
    select s.user_id from public.auth_sessions s
    join auth.users u on u.id = s.user_id
    where s.token_hash = ${hash} and s.expires_at > now()
      and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())`;
  return row?.user_id ?? null;
}

export async function deleteSession(token: string | undefined) {
  if (token) await adminDb`delete from public.auth_sessions where token_hash = ${sha256(token)}`;
}

// Options du cookie de session. Secure partout sauf en local (http://127.0.0.1, http://localhost).
export function sessionCookie(token: string, host: string | null) {
  const local = !host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: !local,
    sameSite: "lax" as const,
    path: "/",
    // Le navigateur garde le cookie au plus 400 jours ; c'est la base qui décide de l'expiration.
    maxAge: 400 * 24 * 3600,
  };
}
