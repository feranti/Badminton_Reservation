import postgres from "postgres";

// Accès direct à Postgres (DATABASE_URL), sans passer par l'API de Supabase.
//
// Les règles d'accès (RLS) restent celles de la base : chaque requête d'un joueur s'exécute dans
// une transaction avec le rôle « authenticated » et l'identifiant du joueur, exactement comme le
// faisait l'API de Supabase. auth.uid() le lit dans request.jwt.claims, et les règles, les
// fonctions et les triggers de supabase/migrations marchent sans changement.
//
// Uniquement côté serveur : DATABASE_URL contient le mot de passe de la base.

export type Tx = postgres.TransactionSql;
type Param = postgres.ParameterOrFragment<never>;

// Une requête SQL écrite comme un modèle (db`select … where id = ${id}`), exécutée dans sa propre
// transaction, ou plusieurs requêtes groupées dans la même transaction avec db.tx(…).
export type Db = {
  <T extends object = postgres.Row>(strings: TemplateStringsArray, ...values: Param[]): Promise<T[]>;
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

const globalForSql = globalThis as unknown as { badmintonSql?: postgres.Sql };

// Connexion créée à la première requête : le build n'a pas besoin de DATABASE_URL.
function getSql() {
  if (globalForSql.badmintonSql) return globalForSql.badmintonSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absente : adresse de connexion à la base Postgres.");
  const sql = postgres(url, {
    // Le pooler de Supabase en mode transaction ne garde pas les requêtes préparées.
    prepare: false,
    max: 5,
    idle_timeout: 30,
    connection: { application_name: "badminton-resas" },
    types: {
      // Entiers longs et numeric (count, row_number, sommes) en nombres, comme l'API de Supabase.
      number8: { to: 20, from: [20, 1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      // Dates avec fuseau en chaînes ISO (« 2026-11-21T19:00:00.000Z »), comme avant.
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (x: string | Date) => (x instanceof Date ? x.toISOString() : x),
        parse: (x: string) => new Date(x).toISOString(),
      },
    },
  });
  globalForSql.badmintonSql = sql;
  return sql;
}

function makeDb(setup: ((tx: Tx) => Promise<unknown>) | null): Db {
  const tx = <T>(fn: (tx: Tx) => Promise<T>) =>
    getSql().begin(async (t) => {
      // Envoyée tout de suite, avant la requête de fn, sur la même connexion : un seul aller-retour.
      const ready = setup?.(t);
      try {
        return await fn(t);
      } finally {
        await ready;
      }
    }) as Promise<T>;
  const db = (<T extends object>(strings: TemplateStringsArray, ...values: Param[]) =>
    tx(async (t) => (await t(strings, ...values)) as unknown as T[])) as Db;
  db.tx = tx;
  return db;
}

// Requêtes au nom d'un joueur connecté : RLS et auth.uid() comme dans l'API de Supabase.
export function playerDb(userId: string): Db {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return makeDb((t) =>
    t`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true)`.execute(),
  );
}

// Requêtes sans joueur (tâches planifiées, e-mails) : propriétaire de la base, sans RLS.
// Remplace le client Supabase à clé secrète.
export const adminDb: Db = makeDb(null);

// Pour une action qui ne doit pas s'interrompre sur une erreur de la base (comme le faisait le
// client Supabase, qui renvoyait l'erreur au lieu de la lever).
export async function attempt<T>(query: Promise<T>): Promise<{ data: T; error: null } | { data: null; error: postgres.PostgresError | Error }> {
  try {
    return { data: await query, error: null };
  } catch (error) {
    return { data: null, error: error as Error };
  }
}
