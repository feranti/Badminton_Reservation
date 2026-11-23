import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { Loading, SubPage } from "@/components/app-shell";
import { ThemePicker } from "@/components/theme-picker";
import { adminDb } from "@/lib/db";
import { requirePlayer } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export default function ProfilePage() {
  return (
    <SubPage back="/" title="Mon profil">
      <Suspense fallback={<Loading variant="form" />}>
        <Profile />
      </Suspense>
      <ThemePicker />
      <div className="flex flex-col border-t border-line">
        <Link href="/?passees=1" className="flex min-h-13 items-center border-b border-line">
          Sessions passées
        </Link>
        <Link href="/comptes/aide" className="flex min-h-13 items-center border-b border-line">
          Comment sont calculés les comptes ?
        </Link>
        <form action={signOut}>
          <button type="submit" className="flex min-h-13 w-full items-center text-danger">
            Se déconnecter
          </button>
        </form>
      </div>
    </SubPage>
  );
}

async function Profile() {
  const { userId, db } = await requirePlayer();
  // L'adresse e-mail est dans auth.users, fermée aux joueurs : lue par le serveur, pour soi seulement.
  const [[data], [auth]] = await Promise.all([
    db<{ display_name: string }>`select display_name from public.profiles where id = ${userId}`,
    adminDb<{ email: string }>`select email from auth.users where id = ${userId}`,
  ]);
  const displayName = data?.display_name ?? "";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3.5">
        <div className="flex size-13 items-center justify-center rounded-full bg-line text-xl font-semibold">
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold">Bonjour {displayName}</span>
          <span className="truncate text-sm text-muted">{auth?.email}</span>
        </div>
      </div>
      <ProfileForm displayName={displayName} />
    </div>
  );
}
