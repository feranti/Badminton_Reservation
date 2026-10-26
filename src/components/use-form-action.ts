"use client";

import { startTransition, useActionState, type FormEvent } from "react";

// Comme useActionState, mais sans vider le formulaire après l'envoi (comportement par défaut de React) :
// en cas d'erreur, le joueur corrige sa saisie au lieu de tout retaper.
export function useFormAction<S extends object>(
  serverAction: (state: S, formData: FormData) => Promise<S>,
  initial: Awaited<S>,
) {
  const [state, action, pending] = useActionState<S, FormData>(serverAction, initial);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Le bouton qui a envoyé le formulaire (name/value) fait partie des données, comme en HTML classique.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => action(formData));
  }

  return { state, pending, onSubmit };
}
