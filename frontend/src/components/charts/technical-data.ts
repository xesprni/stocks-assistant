import type { CandlestickItem, IntradayItem } from "@/types/app";

// ── Data helpers ───────────────────────────────────────────────────────────────

export function parseBars(bars: CandlestickItem[]) {
  return bars.map((b) => ({
    time: b.timestamp,
    open: parseFloat(b.open),
    high: parseFloat(b.high),
    low: parseFloat(b.low),
    close: parseFloat(b.close),
    volume: parseFloat(b.volume),
  }));
}

export function parseIntraday(bars: IntradayItem[]) {
  return bars
    .map((b) => ({
      time: b.timestamp,
      price: parseFloat(b.price),
      volume: parseFloat(b.volume),
      avg_price: parseFloat(b.avg_price),
    }))
    .sort((a, b) => Number(a.time) - Number(b.time));
}

export type ParsedIntradayBar = ReturnType<typeof parseIntraday>[number];

export const DEFAULT_INTRADAY_REFRESH_SECONDS = 5;

export const INTRADAY_REFRESH_STORAGE_KEY = "stocks-assistant.intraday-refresh-seconds";

export const TECHNICAL_WATCHLIST_TAB_STORAGE_KEY = "stocks-assistant.technical.watchlist-tab";

export const TECHNICAL_ACTIVE_TAB_STORAGE_KEY = "stocks-assistant.technical.active-tab";

export const TECHNICAL_KLINE_PERIOD_STORAGE_KEY = "stocks-assistant.technical.kline-period";

export function clampIntradayRefreshSeconds(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_INTRADAY_REFRESH_SECONDS;
  return Math.min(10, Math.max(1, Math.round(value)));
}

export function loadStoredIntradayRefreshSeconds() {
  try {
    const stored = localStorage.getItem(INTRADAY_REFRESH_STORAGE_KEY);
    return stored == null ? DEFAULT_INTRADAY_REFRESH_SECONDS : clampIntradayRefreshSeconds(Number(stored));
  } catch {
    return DEFAULT_INTRADAY_REFRESH_SECONDS;
  }
}

export function sameLocalDate(a: number, b: number) {
  return new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();
}

export function sameIntradayBar(a: ParsedIntradayBar, b: ParsedIntradayBar) {
  return (
    Number(a.time) === Number(b.time) &&
    a.price === b.price &&
    a.volume === b.volume &&
    a.avg_price === b.avg_price
  );
}

export function mergeIntradayBars(current: ParsedIntradayBar[], incoming: ParsedIntradayBar[]) {
  if (current.length === 0) {
    return { bars: incoming, changedStart: 0, replace: true };
  }
  if (incoming.length === 0) {
    return { bars: current, changedStart: current.length, replace: false };
  }

  const firstIncomingTime = Number(incoming[0].time);
  const currentFirstTime = Number(current[0].time);
  const currentLastTime = Number(current[current.length - 1].time);

  if (firstIncomingTime < currentFirstTime || !sameLocalDate(firstIncomingTime, currentLastTime)) {
    return { bars: incoming, changedStart: 0, replace: true };
  }

  let start = current.findIndex((bar) => Number(bar.time) >= firstIncomingTime);
  if (start === -1) start = current.length;

  const next = [...current];
  let changedStart = current.length;
  let cursor = start;

  for (const bar of incoming) {
    const barTime = Number(bar.time);
    while (cursor < next.length && Number(next[cursor].time) < barTime) {
      cursor++;
    }

    if (cursor < next.length && Number(next[cursor].time) === barTime) {
      if (!sameIntradayBar(next[cursor], bar)) {
        next[cursor] = bar;
        changedStart = Math.min(changedStart, cursor);
      }
      cursor++;
      continue;
    }

    next.splice(cursor, 0, bar);
    changedStart = Math.min(changedStart, cursor);
    cursor++;
  }

  const canTailUpdate = changedStart >= current.length - 1;
  return {
    bars: next,
    changedStart,
    replace: !canTailUpdate,
  };
}
