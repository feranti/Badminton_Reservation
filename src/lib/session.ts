import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { SESSION_COOKIE, sessionUser } from "@/lib/auth";
import { playerDb } from "@/lib/db";

// Joueur de la session, lu une seule fois par requête même si plusieurs composants le demandent.
const currentUser = cache(async () => sessionUser((await cookies()).get(SESSION_COOKIE)?.value));

// Renvoie l'identifiant du joueur connecté et l'accès à la base en son nom (db, avec les règles
// d'accès de la base), ou renvoie vers /login.
export async function requirePlayer() {
  // Ces pages dépendent du joueur connecté : on attend la vraie requête avant de calculer quoi que ce soit.
  await connection();
  const userId = await currentUser();
  if (!userId) redirect("/login");
  return { userId, db: playerDb(userId) };
}
