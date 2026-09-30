import {
  type NativeChartTheme
} from "@/components/charts/NativeStockChart";
import {
  useEffect,
  useMemo,
  useState
} from "react";

// ── Theme ─────────────────────────────────────────────────────────────────────

export function useIsDark() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

export function cssHsl(styles: CSSStyleDeclaration, name: string, alpha?: number) {
  const value = styles.getPropertyValue(name).trim();
  if (!value) return alpha == null ? "transparent" : `rgb(0 0 0 / ${alpha})`;
  return alpha == null ? `hsl(${value})` : `hsl(${value} / ${alpha})`;
}

export function useNativeChartTheme(isDark: boolean, upColor: string, downColor: string): NativeChartTheme {
  return useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: cssHsl(styles, "--background"),
      text: cssHsl(styles, "--foreground"),
      mutedText: cssHsl(styles, "--muted-foreground"),
      border: cssHsl(styles, "--border"),
      grid: styles.getPropertyValue("--grid-line").trim() || cssHsl(styles, "--border", isDark ? 0.28 : 0.36),
      crosshair: cssHsl(styles, "--muted-foreground", isDark ? 0.72 : 0.62),
      axisBackground: cssHsl(styles, "--background", 0.92),
      up: upColor,
      down: downColor,
      // 指标线保持独立配色，避免主题色与其他指标线混淆。
      blue: cssHsl(styles, "--chart-blue"),
      orange: cssHsl(styles, "--secondary"),
      purple: isDark ? "#c58af9" : "#7e57c2",
      yellow: isDark ? "#fdd663" : "#b7791f",
    };
  }, [isDark, upColor, downColor]);
}
