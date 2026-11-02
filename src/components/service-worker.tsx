"use client";

import { useEffect } from "react";

// Installe le service worker (public/sw.js), qui reçoit les images partagées vers l'appli.
export function ServiceWorker() {
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
