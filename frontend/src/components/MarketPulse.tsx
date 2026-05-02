import { useEffect, useState } from "react";
import { Activity, CandlestickChart, Gauge, Loader2, Thermometer } from "lucide-react";
import { getMarketTemperature } from "@/lib/api";
import type { MarketTemperature } from "@/types/app";

const markets = [
  { key: "US", label: "US", icon: "🇺🇸" },
  { key: "HK", label: "HK", icon: "🇭🇰" },
  { key: "CN", label: "CN", icon: "🇨🇳" },
] as const;

function sentimentColor(val: number | null): string {
  if (val === null) return "text-muted-foreground";
  if (val >= 70) return "text-green-500";
  if (val >= 40) return "text-yellow-500";
  return "text-red-500";
}

function tempLabel(val: number | null): string {
  if (val === null) return "--";
  if (val >= 80) return "HOT";
  if (val >= 50) return "WARM";
  return "COLD";
}

export function MarketPulse() {
  const [data, setData] = useState<Record<string, MarketTemperature | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMarket, setActiveMarket] = useState<string>("US");

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setIsLoading(true);
      setError(null);
      const results: Record<string, MarketTemperature | null> = {};
      await Promise.allSettled(
        markets.map(async (m) => {
          try {
            results[m.key] = await getMarketTemperature(m.key);
          } catch {
            results[m.key] = null;
          }
        }),
      );
      if (!cancelled) {
        setData(results);
        setIsLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  const active = data[activeMarket];
  const hasData = active && active.temperature !== null;

  if (error && !hasData) {
    return (
      <div className="overflow-hidden rounded-lg border border-border/80 bg-background/50">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CandlestickChart className="size-4 text-primary" />
            MARKET PULSE
          </div>
        </div>
        <div className="grid h-32 place-items-center px-4 text-center">
          <div>
            <Thermometer className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Longbridge 未配置或不可用</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-background/50">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <CandlestickChart className="size-4 text-primary" />
          MARKET PULSE
        </div>
        {isLoading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-primary">
            <Activity className="size-3.5 animate-pulse" />
            LIVE
          </div>
        )}
      </div>

      {/* Market tabs */}
      <div className="flex border-b border-border/70">
        {markets.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
              activeMarket === m.key
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveMarket(m.key)}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Main display */}
      <div className="relative p-3">
        <div className="absolute inset-0 [background-image:linear-gradient(var(--grid-line-soft)_1px,transparent_1px)] bg-[length:100%_28px]" />
        <div className="relative flex items-center gap-4">
          {/* Temperature gauge */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative flex size-20 items-center justify-center rounded-full border-4 border-primary/20">
              <span className="text-2xl font-bold text-primary">
                {hasData ? active.temperature : "--"}
              </span>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">
              {hasData ? tempLabel(active.temperature) : "N/A"}
            </span>
          </div>

          {/* Metrics */}
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-[10px] text-muted-foreground">Valuation</p>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: hasData && active.valuation != null ? `${active.valuation}%` : "0%" }}
                  />
                </div>
                <span className="text-xs font-semibold">
                  {hasData && active.valuation != null ? active.valuation : "--"}
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Sentiment</p>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-secondary transition-all"
                    style={{ width: hasData && active.sentiment != null ? `${active.sentiment}%` : "0%" }}
                  />
                </div>
                <span className={`text-xs font-semibold ${sentimentColor(active?.sentiment ?? null)}`}>
                  {hasData && active.sentiment != null ? active.sentiment : "--"}
                </span>
              </div>
            </div>
            {hasData && active.description ? (
              <p className="text-[10px] leading-4 text-muted-foreground">{active.description}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom bar — mini sparkline for each market */}
      <div className="flex items-center gap-1 border-t border-border/70 px-3 py-2">
        <Gauge className="mb-1 size-4 text-muted-foreground" />
        {markets.map((m) => {
          const d = data[m.key];
          const temp = d?.temperature;
          return (
            <div key={m.key} className="flex-1 text-center">
              <p className="text-[9px] text-muted-foreground">{m.label}</p>
              <p className={`text-xs font-semibold ${temp != null ? (temp >= 50 ? "text-primary" : "text-red-500") : "text-muted-foreground"}`}>
                {temp ?? "--"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
