"use client";

import { errorText, inputClass, labelClass, primaryButton } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm() {
  const { state, pending, onSubmit } = useFormAction<LoginState>(sendMagicLink, {
    status: "idle",
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className={labelClass}>
        E-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="vous@exemple.fr"
        className={`${inputClass} min-h-13`}
      />
      <button type="submit" disabled={pending} className={`${primaryButton} min-h-13`}>
        {pending ? "Envoi…" : "Recevoir un lien de connexion"}
      </button>
      {state.message && (
        <p role="status" className={state.status === "error" ? errorText : "text-sm text-accent-ink"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
