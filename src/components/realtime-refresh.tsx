"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABLES = ["sessions", "court_bookings", "session_participants", "payments"] as const;

// Recharge les données de la page dès qu'un autre joueur modifie quelque chose.
export function RealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 300);
    };

    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    // Le jeton du joueur doit être transmis avant l'abonnement : sinon les règles d'accès
    // traitent la connexion comme anonyme et aucun changement n'arrive.
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled || !data.session) return;
      await supabase.realtime.setAuth(data.session.access_token);
      channel = supabase.channel("changements");
      for (const table of TABLES) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
      }
      channel.subscribe();
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
