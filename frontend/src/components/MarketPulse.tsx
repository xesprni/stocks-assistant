import { Activity, CandlestickChart, Gauge } from "lucide-react";

const bars = [38, 62, 47, 74, 52, 85, 68, 91, 57, 78, 66, 88];
const path = "M8 82 C42 22, 72 96, 108 38 S176 70, 212 30 S276 24, 312 64";

export function MarketPulse() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/80 bg-background/50">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <CandlestickChart className="size-4 text-primary" />
          MARKET PULSE
        </div>
        <div className="flex items-center gap-1.5 text-xs text-primary">
          <Activity className="size-3.5 animate-pulse" />
          LIVE
        </div>
      </div>
      <div className="relative h-[154px] p-3">
        <div className="absolute inset-0 [background-image:linear-gradient(var(--grid-line-soft)_1px,transparent_1px)] bg-[length:100%_28px]" />
        <svg className="relative h-full w-full" viewBox="0 0 320 120" role="img" aria-label="市场走势">
          <path className="pulse-path" d={path} fill="none" stroke="rgba(52, 211, 153, 0.95)" strokeLinecap="round" strokeWidth="4" />
          <path d={`${path} L312 120 L8 120 Z`} fill="url(#pulse-fill)" opacity="0.4" />
          <defs>
            <linearGradient id="pulse-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgb(52, 211, 153)" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="grid grid-cols-3 border-t border-border/70">
        <div className="px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Alpha</p>
          <p className="text-sm font-semibold text-primary">+7.8%</p>
        </div>
        <div className="border-x border-border/70 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Risk</p>
          <p className="text-sm font-semibold text-secondary">MED</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Signal</p>
          <p className="text-sm font-semibold text-accent">42</p>
        </div>
      </div>
      <div className="flex h-10 items-end gap-1 border-t border-border/70 px-3 py-2">
        <Gauge className="mb-1 size-4 text-muted-foreground" />
        {bars.map((bar, index) => (
          <span
            className="w-full rounded-sm bg-primary/70"
            key={`${bar}-${index}`}
            style={{
              height: `${bar}%`,
              animation: `pulsebar ${1.25 + index * 0.05}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
