import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 pb-20">
      <div className="flex flex-col gap-2">
        <h1 className="text-[32px] font-semibold tracking-tight">Résas</h1>
        <p className="text-muted">Badminton entre amis</p>
      </div>
      <Suspense>
        <LinkError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
      <p className="text-center text-sm text-muted">Pas de mot de passe : un lien et un code de connexion arrivent par e-mail.</p>
    </main>
  );
}

async function LinkError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (!error) return null;
  return <p className="text-sm text-danger">Le lien a expiré ou n&apos;est plus valide. Demandez-en un nouveau.</p>;
}
