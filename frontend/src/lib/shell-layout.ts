import type { EffectiveTheme, Theme } from "@/types/ui";

export function isTheme(value: string | null): value is Theme {
  return value === "system" || value === "dark" || value === "light";
}

export function isMobileShellViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

export function systemTheme(): EffectiveTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function effectiveTheme(theme: Theme, systemPreference: EffectiveTheme): EffectiveTheme {
  return theme === "system" ? systemPreference : theme;
}
