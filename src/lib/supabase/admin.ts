import { createClient } from "@supabase/supabase-js";

// Client avec la clé secrète, uniquement côté serveur : sert à lire l'e-mail d'un joueur
// pour le prévenir. Renvoie null si la clé n'est pas configurée.
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
