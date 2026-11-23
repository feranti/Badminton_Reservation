"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { consumeLoginCode, createLoginRequest, createSession, deleteSession, SESSION_COOKIE, sessionCookie } from "@/lib/auth";
import { sendMail } from "@/lib/mail";

export type LoginState = { status: "idle" | "sent" | "error"; email?: string; message?: string };

// Envoie un e-mail de connexion (lien + code à usage unique). Seuls les joueurs invités peuvent se connecter.
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { status: "error", message: "Indiquez votre adresse e-mail." };
  if (email.length > 320) return { status: "error", message: "Adresse e-mail trop longue." };

  // Adresse du lien de l'e-mail : celle du navigateur (Next.js a vérifié qu'elle est bien celle du
  // site avant d'exécuter l'action), sinon l'adresse publique du site (APP_URL).
  const origin = (await headers()).get("origin") ?? process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const request = await createLoginRequest(email, origin);
  if (!request.ok) {
    const message = {
      unknown: "Impossible d'envoyer l'e-mail. Vérifiez que vous avez bien été invité dans le groupe.",
      "too-soon": "Un e-mail vient d'être envoyé à cette adresse : patientez une minute avant d'en redemander un.",
      "too-many": "Trop d'e-mails demandés pour cette adresse : réessayez dans une heure.",
    }[request.reason];
    return { status: "error", message };
  }

  try {
    await sendMail({
      to: request.email,
      // Format repéré par Gmail (« Copier le code ») et iOS : le code dans l'objet, puis en tête du
      // corps juste après « code de connexion : », et aucun autre nombre dans l'e-mail.
      subject: `${request.code} est votre code de connexion à Badminton Résas`,
      text: [
        `Votre code de connexion : ${request.code}`,
        "",
        "Saisissez-le dans l'appli Badminton Résas. Il est valable une heure.",
        "",
        "Vous pouvez aussi vous connecter avec ce lien :",
        request.link,
        "",
        "Si vous n'avez rien demandé, ignorez cet e-mail.",
      ].join("\n"),
      html: `<p>Votre code de connexion : <strong style="font-size:24px;letter-spacing:4px">${request.code}</strong></p>
<p>Saisissez-le dans l'appli Badminton Résas. Il est valable une heure.</p>
<p>Vous pouvez aussi vous connecter avec ce lien : <a href="${escapeHtml(request.link)}">Se connecter</a></p>
<p>Si vous n'avez rien demandé, ignorez cet e-mail.</p>`,
    });
  } catch (error) {
    console.error("[connexion] e-mail non envoyé", error);
    return { status: "error", message: "L'e-mail n'a pas pu partir. Réessayez dans une minute." };
  }
  return { status: "sent", email, message: `E-mail envoyé à ${email}.` };
}

// Connexion avec le code reçu par e-mail : la session s'ouvre dans ce navigateur-ci,
// sans avoir à ouvrir le lien (pratique depuis l'icône de l'écran d'accueil ou l'appli Gmail).
export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 8) {
    return { ...prev, status: "sent", email, message: "Saisissez les 8 chiffres du code reçu par e-mail." };
  }

  const userId = await consumeLoginCode(email, code);
  if (!userId) {
    return { ...prev, status: "sent", email, message: "Code incorrect ou expiré. Vérifiez-le ou demandez un nouvel e-mail." };
  }
  const token = await createSession(userId);
  (await cookies()).set(sessionCookie(token, (await headers()).get("host")));
  redirect("/");
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function signOut() {
  const store = await cookies();
  await deleteSession(store.get(SESSION_COOKIE)?.value);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
