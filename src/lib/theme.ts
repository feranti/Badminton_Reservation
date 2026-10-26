// Thème d'affichage choisi par le joueur, gardé dans le navigateur.
// « system » (par défaut) suit le réglage clair ou sombre du téléphone.
export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "theme";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
