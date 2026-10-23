"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {
    status: "idle",
  });

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        Adresse e-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="vous@exemple.fr"
        className="rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? "Envoi…" : "Recevoir un lien de connexion"}
      </button>
      {state.message && (
        <p
          role="status"
          className={state.status === "error" ? "text-sm text-red-600" : "text-sm text-emerald-700"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
