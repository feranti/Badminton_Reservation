import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Renvoie le client Supabase et l'identifiant du joueur connecté, ou renvoie vers /login.
export async function requirePlayer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect("/login");
  return { supabase, userId };
}
