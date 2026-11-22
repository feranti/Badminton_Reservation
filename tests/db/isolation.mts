// Sécurité de l'accès direct à la base (src/lib/db.ts), lancé par scripts/check.sh :
// chaque requête d'un joueur garde son identité et son rôle, même avec des requêtes simultanées
// sur les mêmes connexions, et rien ne déborde sur la requête suivante.
// Usage : DATABASE_URL=… node --conditions=react-server --experimental-strip-types tests/db/isolation.mts
import { adminDb, onDbChange, playerDb } from "../../src/lib/db.ts";

let failed = false;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed = true;
};

const players = await adminDb<{ id: string }>`select id from public.profiles order by created_at limit 2`;
if (players.length < 2) throw new Error("Il faut au moins deux joueurs en base.");
const [a, b] = players.map((p) => p.id);

// 1. Identité et rôle sous charge : 300 requêtes mêlées (joueur A, joueur B, sans joueur).
type Who = { uid: string | null; role: string; claims: string | null };
const who = (db: typeof adminDb) =>
  db<Who>`select auth.uid() as uid, current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims`;
const runs = await Promise.all(
  Array.from({ length: 300 }, (_, i) => {
    const kind = i % 3;
    const db = kind === 0 ? playerDb(a) : kind === 1 ? playerDb(b) : adminDb;
    return who(db).then(([w]) => ({ kind, w }));
  }),
);
check(
  runs.every(({ kind, w }) =>
    kind === 2 ? w.uid === null && w.role === "postgres" && w.claims === null : w.role === "authenticated" && w.uid === (kind === 0 ? a : b),
  ),
  "300 requêtes simultanées : chaque joueur garde son identité, et les requêtes sans joueur n'héritent de rien",
);

// 2. Une requête de joueur en erreur ne laisse pas son rôle sur la connexion.
await playerDb(a)`select 1 / 0`.catch(() => null);
const after = await Promise.all(Array.from({ length: 10 }, () => who(adminDb)));
check(after.every(([w]) => w.role === "postgres" && w.uid === null), "après une erreur, la connexion revient au rôle du serveur");

// 3. Les règles d'accès s'appliquent : A ne peut ni renommer B, ni lire les adresses e-mail.
const renamed = await playerDb(a)`update public.profiles set display_name = 'pirate' where id = ${b} returning id`;
check(renamed.length === 0, "un joueur ne peut pas modifier le profil d'un autre");
const emails = await playerDb(a)`select email from auth.users`.then(() => "lu", (e: { code?: string }) => e.code);
check(emails === "42501", "un joueur ne peut pas lire auth.users (adresses e-mail)");
// Remarque : Postgres laisse toujours revenir au rôle de connexion (set role postgres). Ce n'est
// exploitable qu'avec une injection SQL, d'où la règle : jamais de texte SQL construit à la main,
// seulement des paramètres (point 5).

// 4. Un identifiant de joueur qui n'est pas un UUID est refusé avant toute requête.
let refused = false;
try {
  playerDb("x', 'postgres");
} catch {
  refused = true;
}
check(refused, "un identifiant de joueur mal formé est refusé");

// 5. Les valeurs passent en paramètres : une chaîne piégée reste du texte.
const trap = "'; drop table public.sessions; --";
const [echo] = await playerDb(a)<{ v: string }>`select ${trap}::text as v`;
const [{ n }] = await adminDb<{ n: number }>`select count(*) as n from pg_tables where schemaname = 'public' and tablename = 'sessions'`;
check(echo.v === trap && n === 1, "une valeur piégée est transmise comme texte, sans être exécutée");

// 6. Une adresse de base invalide n'apparaît jamais dans le message d'erreur (mot de passe).
{
  const { execFileSync } = await import("node:child_process");
  const secret = "motdepasse-secret-123";
  let output = "";
  try {
    execFileSync(
      process.execPath,
      ["--conditions=react-server", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
        `const { adminDb } = await import(${JSON.stringify(new URL("../../src/lib/db.ts", import.meta.url).href)}); await adminDb\`select 1\`;`],
      { env: { ...process.env, DATABASE_URL: secret }, stdio: "pipe" },
    );
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  check(output.includes("DATABASE_URL invalide") && !output.includes(secret), "une DATABASE_URL invalide est refusée sans recopier sa valeur");
}

// 7. Images des QR codes : un joueur n'en ajoute qu'en son nom, et ne peut ni les modifier ni
//    les supprimer.
{
  const code = (q: Promise<unknown>) => q.then(() => "ok", (e: { code?: string }) => e.code ?? "erreur");
  const bytes = Buffer.from("%PDF-1.4 test");
  const asOther = await code(playerDb(a)`insert into public.qr_images (path, content_type, data, created_by) values ('test/b.pdf', 'application/pdf', ${bytes}, ${b})`);
  const own = await code(playerDb(a)`insert into public.qr_images (path, content_type, data) values ('test/a.pdf', 'application/pdf', ${bytes})`);
  const svg = await code(playerDb(a)`insert into public.qr_images (path, content_type, data) values ('test/a.svg', 'image/svg+xml', ${bytes})`);
  const edit = await code(playerDb(b)`update public.qr_images set data = ${bytes} where path = 'test/a.pdf'`);
  const del = await code(playerDb(b)`delete from public.qr_images where path = 'test/a.pdf'`);
  check(asOther === "42501" && own === "ok" && svg === "23514" && edit === "42501" && del === "42501",
    `images des QR codes : ajout en son nom seulement, types limités, ni modification ni suppression (${asOther}, ${own}, ${svg}, ${edit}, ${del})`);
  await adminDb`delete from public.qr_images where path like 'test/%'`;
}

// 8. Temps réel : une modification d'une table affichée est signalée, avec son seul nom.
{
  const received = new Promise<string>((resolve) => {
    const stop = onDbChange((table) => {
      stop();
      resolve(table);
    });
  });
  await new Promise((r) => setTimeout(r, 1000)); // le temps d'ouvrir l'écoute
  await playerDb(a)`update public.sessions set notes = notes where false`;
  const table = await Promise.race([received, new Promise((r) => setTimeout(() => r("rien"), 5000))]);
  check(table === "sessions", `une modification de sessions est signalée aux pages ouvertes (${table})`);
}

if (failed) process.exit(1);
console.log("Accès direct à la base : tout est bon.");
process.exit(0);
