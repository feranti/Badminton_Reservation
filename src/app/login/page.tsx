import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Badminton Résas</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Connectez-vous avec le lien envoyé par e-mail.
        </p>
      </div>
      <Suspense>
        <LinkError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </main>
  );
}

async function LinkError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (!error) return null;
  return (
    <p className="text-sm text-red-600">
      Le lien a expiré ou n&apos;est plus valide. Demandez-en un nouveau.
    </p>
  );
}
