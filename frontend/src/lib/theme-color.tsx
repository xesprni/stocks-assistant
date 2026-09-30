import { useLayoutEffect } from "react";

export const THEME_COLORS = ["blue", "violet", "teal", "green", "orange", "rose"] as const;
export type ThemeColor = typeof THEME_COLORS[number];
export const DEFAULT_THEME_COLOR: ThemeColor = "blue";

export function normalizeThemeColor(value: unknown): ThemeColor {
  return THEME_COLORS.includes(value as ThemeColor) ? value as ThemeColor : DEFAULT_THEME_COLOR;
}

// 账号配置草稿是唯一状态来源；退出账号时清理 DOM，避免下一位用户继承颜色。
export function useThemeColor(value: unknown) {
  const themeColor = normalizeThemeColor(value);
  useLayoutEffect(() => {
    document.documentElement.dataset.themeColor = themeColor;
    return () => { delete document.documentElement.dataset.themeColor; };
  }, [themeColor]);
}
