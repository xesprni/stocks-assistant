import { TECHNICAL_WATCHLIST_TAB_STORAGE_KEY } from "@/components/charts/technical-data";
import { type TechnicalCopy } from "@/components/charts/technical-settings";
import { localizedSymbolName, type AppLanguage } from "@/i18n";
import { listWatchlist } from "@/lib/api";
import { readStoredValue, writeStoredValue } from "@/lib/local-storage";
import type { WatchlistItem } from "@/types/app";
import { TrendingUp } from "lucide-react";
import {
  useEffect,
  useState
} from "react";

// ── Watchlist sidebar ─────────────────────────────────────────────────────────

export function watchlistDisplayName(item: WatchlistItem, language: AppLanguage) {
  return localizedSymbolName(item, language);
}

export function SymbolSideNav({
  active,
  copy,
  language,
  onSelect,
}: {
  active: string;
  copy: TechnicalCopy;
  language: AppLanguage;
  onSelect: (s: string, name: string) => void;
}) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [tab, setTab] = useState<"US" | "A" | "H">(() =>
    readStoredValue(TECHNICAL_WATCHLIST_TAB_STORAGE_KEY, ["US", "A", "H"], "US"),
  );
  const categoryLabels: Record<"US" | "A" | "H", string> = { US: copy.us, A: copy.a, H: copy.h };

  useEffect(() => {
    writeStoredValue(TECHNICAL_WATCHLIST_TAB_STORAGE_KEY, tab);
  }, [tab]);

  useEffect(() => {
    listWatchlist(tab)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [tab]);

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-hidden border-b border-border bg-card md:max-h-none md:w-40 md:border-b-0 md:border-r">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-2">
        <TrendingUp size={13} className="text-primary" />
        <span className="text-[11px] font-semibold tracking-wide text-foreground">{copy.watchlist}</span>
      </div>
      <div className="flex border-b border-border">
        {(["US", "A", "H"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={`flex-1 py-1.5 text-[11px] font-medium transition-all ${tab === c
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            {categoryLabels[c]}
          </button>
        ))}
      </div>
      <div className="flex overflow-x-auto md:block md:flex-1 md:overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">{copy.noData}</div>
        ) : (
          items.map((item) => {
            const displayName = watchlistDisplayName(item, language);
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.symbol, displayName)}
                className={`group relative w-36 shrink-0 border-r border-border/50 px-3 py-2.5 text-left transition-colors md:w-full md:border-b md:border-r-0 ${item.symbol === active
                    ? "bg-primary/5"
                    : "hover:bg-muted/50"
                  }`}
              >
                {item.symbol === active && (
                  <span className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-primary" />
                )}
                <div className={`truncate text-xs font-semibold ${item.symbol === active ? "text-primary" : "text-foreground"
                  }`}>
                  {item.symbol}
                </div>
                <div className="truncate text-[10px] text-muted-foreground group-hover:text-foreground/70">
                  {displayName}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
