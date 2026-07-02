export type Theme = "light" | "dark";
const KEY = "poc-theme";

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(KEY, theme);
}
