import { redirect } from "next/navigation";
import { connection } from "next/server";
import { playerDb } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

// Renvoie l'identifiant du joueur connecté et l'accès à la base en son nom (db, avec les règles
// d'accès de la base), ou renvoie vers /login. Le client Supabase ne sert plus qu'à la connexion
// et au stockage des QR codes.
export async function requirePlayer() {
  // Ces pages dépendent du joueur connecté : on attend la vraie requête avant de calculer quoi que ce soit
  // (le client Supabase lit l'heure pour vérifier la session).
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");
  return { supabase, userId, db: playerDb(userId) };
}
