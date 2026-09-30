import type { AppLanguage } from "@/i18n";
import { i18n } from "@/i18n";
import { useColorScheme } from "@/lib/color-scheme";
import { TrendingUp } from "lucide-react";

// ── Color Scheme Toggle ─────────────────────────────────────────────────────────

export function ColorSchemeRow({ language }: { language: AppLanguage }) {
  const { scheme, setScheme } = useColorScheme();
  const copy = i18n[language].config;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/80 bg-background/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
          <TrendingUp className="size-4 text-secondary" />
        </div>
        <div className="min-w-0">
          <span className="truncate text-sm font-medium">{copy.colorScheme}</span>
          <p className="text-[10px] text-muted-foreground">
            {scheme === "cn" ? copy.colorSchemeCn : copy.colorSchemeIntl}
          </p>
        </div>
      </div>
      <div role="group" aria-label={copy.colorScheme} className="grid shrink-0 grid-cols-2 rounded-md border border-border/80 bg-muted/40 p-0.5">
        <button
          aria-pressed={scheme === "intl"}
          className={`min-h-9 rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors ${scheme === "intl"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
            }`}
          onClick={() => setScheme("intl")}
          type="button"
        >
          {copy.colorSchemeIntl}
        </button>
        <button
          aria-pressed={scheme === "cn"}
          className={`min-h-9 rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors ${scheme === "cn"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
            }`}
          onClick={() => setScheme("cn")}
          type="button"
        >
          {copy.colorSchemeCn}
        </button>
      </div>
    </div>
  );
}
