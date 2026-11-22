"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Recharge les données de la page dès qu'un autre joueur modifie quelque chose.
// Le serveur envoie le nom de la table modifiée (/api/changements) ; le navigateur se reconnecte
// tout seul si le flux se coupe, et recharge alors la page au cas où un changement aurait été manqué.
export function RealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };

    const source = new EventSource("/api/changements");
    let opened = false;
    source.onopen = () => {
      if (opened) scheduleRefresh();
      opened = true;
    };
    source.onmessage = scheduleRefresh;

    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [router]);

  return null;
}
