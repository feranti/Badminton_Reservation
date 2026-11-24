import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serveur autonome (.next/standalone) pour l'image Docker déployée par Dokploy (voir Dockerfile).
  output: "standalone",
  cacheComponents: true,
  experimental: {
    // Le cache de build de Turbopack a servi en ligne une ancienne version de globals.css
    // (thème et couleurs absents) : on reconstruit les styles à chaque build.
    turbopackFileSystemCacheForBuild: false,
    // Les QR codes (jusqu'à 10 Mo, voir src/lib/qr-image.ts) passent par une action serveur.
    serverActions: { bodySizeLimit: "11mb" },
    proxyClientMaxBodySize: "11mb",
  },
  partialPrefetching: true,
  async headers() {
    return [
      // En-têtes de sécurité de toutes les réponses. Le site ne peut être affiché dans un cadre que
      // par lui-même (les QR codes en PDF s'ouvrent dans un cadre de la page de la session) : un
      // autre site ne peut pas le cacher sous ses boutons pour faire cliquer « J'ai reçu ».
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // Le service worker doit toujours être relu pour que ses mises à jour arrivent.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
