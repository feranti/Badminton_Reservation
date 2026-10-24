import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { requirePlayer } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
      <AppHeader />
      <h1 className="text-2xl font-semibold">Mon nom</h1>
      <Suspense fallback={<p className="text-zinc-500">Chargement…</p>}>
        <Profile />
      </Suspense>
    </main>
  );
}

async function Profile() {
  const { supabase, userId } = await requirePlayer();
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).single();
  return <ProfileForm displayName={data?.display_name ?? ""} />;
}
