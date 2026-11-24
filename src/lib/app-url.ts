import "server-only";
import { headers } from "next/headers";

// Adresse publique du site pour les liens envoyés hors du site (e-mail de connexion, e-mails de
// liste d'attente, messages WhatsApp) et les redirections après connexion.
//
// Toujours APP_URL quand elle existe : les en-têtes Origin et X-Forwarded-Host sont écrits par
// celui qui envoie la requête. Si un proxy les laissait passer, un inconnu pourrait faire envoyer à
// un joueur un vrai e-mail de connexion dont le lien mène chez lui, et récupérer la session.
// Sans APP_URL (copie locale, tests), l'en-tête Host de la requête : derrière Traefik, une requête
// n'arrive au site que si Host est son nom de domaine.
export async function appOrigin() {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured && URL.canParse(configured)) return new URL(configured).origin;
  const h = await headers();
  const host = h.get("host");
  if (!host || !/^[\w.-]+(:\d+)?$|^\[[\da-f:]+\](:\d+)?$/i.test(host)) return null;
  const proto = h.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${proto}://${host}`;
}
