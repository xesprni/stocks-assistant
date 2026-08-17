import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";
import type { ColorScheme } from "@/types/app";

const STORAGE_KEY = "stocks-assistant-color-scheme";

type ChartColors = { up: string; down: string };

const CHART_COLOR_FALLBACKS: ChartColors = {
  up: "#00a97f",
  down: "#e83046",
};

function readChartColors(): ChartColors {
  if (typeof window === "undefined" || typeof document === "undefined") return CHART_COLOR_FALLBACKS;
  const styles = window.getComputedStyle(document.documentElement);
  return {
    up: styles.getPropertyValue("--color-up-chart").trim() || CHART_COLOR_FALLBACKS.up,
    down: styles.getPropertyValue("--color-down-chart").trim() || CHART_COLOR_FALLBACKS.down,
  };
}

const ColorSchemeContext = createContext<{
  scheme: ColorScheme;
  setScheme: (s: ColorScheme) => void;
  upColor: string;
  downColor: string;
}>({
  scheme: "intl",
  setScheme: () => {},
  upColor: CHART_COLOR_FALLBACKS.up,
  downColor: CHART_COLOR_FALLBACKS.down,
});

const TAILWIND_CLASSES: Record<ColorScheme, { up: string; down: string }> = {
  intl: { up: "text-[var(--color-up)]", down: "text-[var(--color-down)]" },
  cn:   { up: "text-[var(--color-up)]", down: "text-[var(--color-down)]" },
};

export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>(() => {
    return readStoredValue(STORAGE_KEY, ["cn", "intl"], "intl");
  });
  const [chartColors, setChartColors] = useState<ChartColors>(readChartColors);

  useEffect(() => {
    writeStoredValue(STORAGE_KEY, scheme);
    const root = document.documentElement;
    root.setAttribute("data-color-scheme", scheme);

    const syncChartColors = () => {
      const next = readChartColors();
      setChartColors((current) => (
        current.up === next.up && current.down === next.down ? current : next
      ));
    };
    syncChartColors();

    const observer = new MutationObserver(syncChartColors);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-color-scheme"],
    });
    return () => observer.disconnect();
  }, [scheme]);

  function setScheme(s: ColorScheme) {
    setSchemeState(s);
  }

  return (
    <ColorSchemeContext.Provider
      value={{
        scheme,
        setScheme,
        upColor: chartColors.up,
        downColor: chartColors.down,
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
