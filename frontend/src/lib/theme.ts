export type Theme = "dark" | "light";
export const THEME_KEY = "sg-theme";

export function normalizeTheme(v: string | null | undefined): Theme {
  return v === "light" ? "light" : "dark";
}

export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return normalizeTheme(document.documentElement.getAttribute("data-theme"));
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable */
  }
}

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}})()`;
