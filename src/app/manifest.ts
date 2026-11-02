import type { MetadataRoute } from "next";

// Permet d'ajouter l'appli à l'écran d'accueil du téléphone avec l'icône du volant.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Badminton Résas",
    short_name: "Badminton",
    description: "Réservations de terrains et comptes entre amis",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#fafaf9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
