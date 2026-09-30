import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";

export const THEME_COLORS = ["blue", "violet", "teal", "green", "orange", "rose"] as const;
type ThemeColor = typeof THEME_COLORS[number];
const STORAGE_KEY = "stocks-assistant-theme-color";

const ThemeColorContext = createContext<{
  themeColor: ThemeColor;
  setThemeColor: (color: ThemeColor) => void;
}>({ themeColor: "blue", setThemeColor: () => {} });

export function ThemeColorProvider({ children }: { children: ReactNode }) {
  const [themeColor, setThemeColor] = useState<ThemeColor>(() => (
    readStoredValue(STORAGE_KEY, THEME_COLORS, "blue")
  ));

  useLayoutEffect(() => {
    document.documentElement.dataset.themeColor = themeColor;
    writeStoredValue(STORAGE_KEY, themeColor);
  }, [themeColor]);

  return (
    <ThemeColorContext.Provider value={{ themeColor, setThemeColor }}>
      {children}
    </ThemeColorContext.Provider>
  );
}

export function useThemeColor() {
  return useContext(ThemeColorContext);
}
