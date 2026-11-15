import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serveur autonome (.next/standalone) pour l'image Docker déployée par Dokploy (voir Dockerfile).
  output: "standalone",
  cacheComponents: true,
  experimental: {
    // Le cache de build de Turbopack a servi en ligne une ancienne version de globals.css
    // (thème et couleurs absents) : on reconstruit les styles à chaque build.
    turbopackFileSystemCacheForBuild: false,
  },
  partialPrefetching: true,
  // Le service worker doit toujours être relu pour que ses mises à jour arrivent.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
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
