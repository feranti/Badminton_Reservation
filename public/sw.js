// Service worker de Badminton Résas.
// Sur Android, l'appli installée apparaît dans le menu « Partager » (voir share_target dans
// src/app/manifest.ts). L'image partagée arrive ici : on la garde en cache puis on ouvre
// /partager, qui laisse choisir la résa et l'heure du QR code.
const CACHE = "partage";
const FICHIER = "/partager/fichier";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/partager/recevoir") return;
  event.respondWith(
    (async () => {
      const data = await event.request.formData();
      const file = data.getAll("qr").find((f) => f instanceof File);
      const cache = await caches.open(CACHE);
      if (file) {
        await cache.put(
          FICHIER,
          new Response(file, { headers: { "content-type": file.type, "x-nom": encodeURIComponent(file.name) } }),
        );
      }
      return Response.redirect(file ? "/partager" : "/partager?erreur=1", 303);
    })(),
  );
});
