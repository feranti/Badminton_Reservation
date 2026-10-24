import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Renvoie le client Supabase et l'identifiant du joueur connecté, ou renvoie vers /login.
export async function requirePlayer() {
  // Ces pages dépendent du joueur connecté : on attend la vraie requête avant de calculer quoi que ce soit
  // (le client Supabase lit l'heure pour vérifier la session).
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");
  return { supabase, userId };
}
