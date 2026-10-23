import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export default function Home() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();

  async function logout() {
    "use server";
    await signOut();
    redirect("/login");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Badminton Résas</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
            Se déconnecter
          </button>
        </form>
      </header>
      <p>Bonjour {profile?.display_name ?? "!"} 👋</p>
      <p className="text-zinc-600 dark:text-zinc-400">
        Les réservations partagées et les comptes arrivent dans les prochaines étapes.
      </p>
    </main>
  );
}
