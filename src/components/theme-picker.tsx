"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, THEME_KEY, type Theme } from "@/lib/theme";

const OPTIONS: [Theme, string][] = [
  ["light", "Clair"],
  ["dark", "Sombre"],
  ["system", "Système"],
];

const listeners = new Set<() => void>();
function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

// Choix du thème d'affichage, gardé dans ce navigateur.
export function ThemePicker() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readTheme,
    () => "system" as Theme,
  );

  function choose(t: Theme) {
    try {
      if (t === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch {}
    applyTheme(t);
    listeners.forEach((cb) => cb());
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-muted">Apparence</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-chip p-1">
        {OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            onClick={() => choose(value)}
            className={`min-h-10 rounded-lg text-sm ${
              theme === value ? "bg-surface font-semibold text-ink shadow-sm" : "font-medium text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
