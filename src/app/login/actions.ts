"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; email?: string; message?: string };

// Envoie un e-mail de connexion (lien + code à 6 chiffres). Seuls les joueurs invités peuvent se connecter.
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { status: "error", message: "Indiquez votre adresse e-mail." };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) {
    return {
      status: "error",
      message: "Impossible d'envoyer l'e-mail. Vérifiez que vous avez bien été invité dans le groupe.",
    };
  }
  return { status: "sent", email, message: `E-mail envoyé à ${email}.` };
}

// Connexion avec le code à 6 chiffres reçu par e-mail : la session s'ouvre dans ce navigateur-ci,
// sans avoir à ouvrir le lien (pratique depuis l'icône de l'écran d'accueil ou l'appli Gmail).
export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (token.length !== 6) return { ...prev, status: "sent", email, message: "Le code fait 6 chiffres." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    return { ...prev, status: "sent", email, message: "Code incorrect ou expiré. Vérifiez-le ou demandez un nouvel e-mail." };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
