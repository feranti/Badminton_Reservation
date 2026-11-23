import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";

// Transition : un joueur encore connecté avec l'ancienne session Supabase reçoit une session du
// site sans avoir à se reconnecter. À supprimer quand la base aura quitté Supabase.
export function supabaseCookies(request: NextRequest) {
  return request.cookies.getAll().filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
}

// Identifiant du joueur de l'ancienne session Supabase (jeton vérifié par Supabase), ou null.
export async function supabaseUserId(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} },
  });
  const { data } = await supabase.auth.getClaims().catch(() => ({ data: null }));
  const sub = data?.claims.sub;
  return typeof sub === "string" ? sub : null;
}
