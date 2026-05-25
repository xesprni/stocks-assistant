import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ColorScheme } from "@/types/app";

const STORAGE_KEY = "stocks-assistant-color-scheme";

const ColorSchemeContext = createContext<{
  scheme: ColorScheme;
  setScheme: (s: ColorScheme) => void;
  upColor: string;
  downColor: string;
}>({
  scheme: "intl",
  setScheme: () => {},
  upColor: "#089981",
  downColor: "#f23645",
});

const SCHEME_COLORS: Record<ColorScheme, { up: string; down: string }> = {
  intl: { up: "#089981", down: "#f23645" },
  cn:   { up: "#f23645", down: "#089981" },
};

const TAILWIND_CLASSES: Record<ColorScheme, { up: string; down: string }> = {
  intl: { up: "text-emerald-500", down: "text-red-500" },
  cn:   { up: "text-red-500", down: "text-emerald-500" },
};

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "cn" || stored === "intl" ? stored : "intl";
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, scheme);
    document.documentElement.setAttribute("data-color-scheme", scheme);
  }, [scheme]);

  function setScheme(s: ColorScheme) {
    setSchemeState(s);
  }

  const colors = SCHEME_COLORS[scheme];

  return (
    <ColorSchemeContext.Provider
      value={{
        scheme,
        setScheme,
        upColor: colors.up,
        downColor: colors.down,
      }}
    >
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function useColorScheme() {
  return useContext(ColorSchemeContext);
}

export function useChartColors() {
  const { upColor, downColor } = useContext(ColorSchemeContext);
  return { upColor, downColor };
}

/** Get tailwind text color classes for the current scheme */
export function useToneClasses() {
  const { scheme } = useContext(ColorSchemeContext);
  return TAILWIND_CLASSES[scheme];
}
