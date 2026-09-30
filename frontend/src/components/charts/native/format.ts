export function formatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatUtcDateLabel(time: number) {
  const date = new Date(time * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}-${day}`;
}

export function isIntradayScale(times: number[]) {
  for (let index = 1; index < times.length; index++) {
    const diff = Math.abs(times[index] - times[index - 1]);
    if (diff > 0 && diff < 12 * 60 * 60) return true;
  }
  return false;
}

export function formatTimeLabel(time: number, intraday: boolean) {
  if (!intraday) return formatUtcDateLabel(time);
  const date = new Date(time * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
