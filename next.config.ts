import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Le cache de build de Turbopack a servi en ligne une ancienne version de globals.css
    // (thème et couleurs absents) : on reconstruit les styles à chaque build.
    turbopackFileSystemCacheForBuild: false,
  },
  partialPrefetching: true,
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
