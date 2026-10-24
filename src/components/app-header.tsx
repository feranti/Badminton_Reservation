import Link from "next/link";
import { signOut } from "@/app/login/actions";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <Link href="/" className="text-lg font-semibold whitespace-nowrap">
        🏸 Badminton Résas
      </Link>
      <nav className="flex items-center gap-3 text-sm whitespace-nowrap">
        <Link href="/profil" className="text-zinc-600 hover:underline dark:text-zinc-400">
          Mon nom
        </Link>
        <form action={signOut}>
          <button type="submit" className="text-zinc-600 hover:underline dark:text-zinc-400">
            Déconnexion
          </button>
        </form>
      </nav>
    </header>
  );
}
