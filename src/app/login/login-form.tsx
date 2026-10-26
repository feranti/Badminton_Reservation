"use client";

import { useState } from "react";
import { errorText, inputClass, labelClass, primaryButton, quietButton } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import { sendMagicLink, verifyCode, type LoginState } from "./actions";

export function LoginForm() {
  // Change de clé pour repartir d'un formulaire vierge quand on veut changer d'adresse.
  const [attempt, setAttempt] = useState(0);
  return <Steps key={attempt} onRestart={() => setAttempt((n) => n + 1)} />;
}

function Steps({ onRestart }: { onRestart: () => void }) {
  const sent = useFormAction<LoginState>(sendMagicLink, { status: "idle" });
  if (sent.state.status === "sent" && sent.state.email) {
    return <CodeForm email={sent.state.email} onRestart={onRestart} />;
  }

  return (
    <form onSubmit={sent.onSubmit} className="flex flex-col gap-3">
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
      <button type="submit" disabled={sent.pending} className={`${primaryButton} min-h-13`}>
        {sent.pending ? "Envoi…" : "Recevoir un lien de connexion"}
      </button>
      {sent.state.message && (
        <p role="status" className={errorText}>
          {sent.state.message}
        </p>
      )}
    </form>
  );
}

function CodeForm({ email, onRestart }: { email: string; onRestart: () => void }) {
  const { state, pending, onSubmit } = useFormAction<LoginState>(verifyCode, { status: "sent", email });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p role="status" className="text-sm text-accent-ink">
        E-mail envoyé à {email}. Ouvrez le lien qu&apos;il contient, ou saisissez ici le code indiqué.
      </p>
      <input type="hidden" name="email" value={email} />
      <label htmlFor="code" className={labelClass}>
        Code reçu par e-mail
      </label>
      <input
        id="code"
        name="code"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={12}
        placeholder="12345678"
        className={`${inputClass} min-h-13 text-center text-xl tracking-[0.3em]`}
      />
      <button type="submit" disabled={pending} className={`${primaryButton} min-h-13`}>
        {pending ? "Vérification…" : "Se connecter"}
      </button>
      {state.message && (
        <p role="alert" className={errorText}>
          {state.message}
        </p>
      )}
      <button type="button" onClick={onRestart} className={`${quietButton} self-center`}>
        Changer d&apos;adresse ou renvoyer un e-mail
      </button>
    </form>
  );
}
