// L'image partagée est normalement reçue par le service worker (public/sw.js).
// S'il n'était pas encore installé, on revient sur /partager pour demander de recommencer.
// Redirection relative : request.url, dans le conteneur du VPS, porte l'adresse d'écoute du
// serveur (https://0.0.0.0:3000) et non celle du site.
export function POST() {
  return new Response(null, { status: 303, headers: { Location: "/partager?erreur=1" } });
}
