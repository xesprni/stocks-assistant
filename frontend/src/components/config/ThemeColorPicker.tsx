import { i18n, type AppLanguage } from "@/i18n";
import { THEME_COLORS, useThemeColor } from "@/lib/theme-color";
import { Check } from "lucide-react";

export function ThemeColorPicker({ language }: { language: AppLanguage }) {
  const { themeColor, setThemeColor } = useThemeColor();
  const copy = i18n[language].config;

  return (
    <fieldset className="min-w-0" aria-describedby="theme-color-hint">
      <legend className="text-sm font-medium">{copy.themeColor}</legend>
      <p id="theme-color-hint" className="mt-1 text-xs leading-5 text-muted-foreground">{copy.themeColorHint}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {THEME_COLORS.map((color) => (
          <label key={color} className="relative min-w-0 cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name="theme-color"
              value={color}
              checked={themeColor === color}
              onChange={() => setThemeColor(color)}
            />
            <span className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background/50 p-2 text-xs transition-colors hover:bg-muted/60 peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
              <span data-theme-color={color} className="theme-color-swatch grid size-7 place-items-center rounded-full" aria-hidden="true">
                {themeColor === color ? <Check className="size-4" strokeWidth={3} /> : null}
              </span>
              {copy.themeColors[color]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
