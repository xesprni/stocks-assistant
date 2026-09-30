export interface ChipInputBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChipBar {
  price: number;
  low: number;
  high: number;
  volume: number;
  profitVolume: number;
  percent: number;
}

export interface ChipDistribution {
  chips: ChipBar[];
  totalVolume: number;
  lastClose: number | null;
  profitRatio: number | null;
  averageCost: number | null;
  peakCost: number | null;
  cost70: [number, number] | null;
  cost90: [number, number] | null;
  sampleCount: number;
}

/** 成交量在每根 K 线高低价间均匀分配，按时间衰减；这是成本估算，不代表真实持仓。 */
export function calcChipDistribution(
  bars: readonly ChipInputBar[],
  priceStep = 0,
  decay = 0.95,
  maxBins = 80,
): ChipDistribution {
  const valid = bars.filter((bar) => (
    [bar.low, bar.high, bar.close, bar.volume].every(Number.isFinite)
    && bar.low > 0 && bar.high >= bar.low && bar.close >= bar.low && bar.close <= bar.high && bar.volume >= 0
  ));
  const lastClose = valid.length ? valid[valid.length - 1].close : null;
  const empty: ChipDistribution = {
    chips: [], totalVolume: 0, lastClose, profitRatio: null, averageCost: null,
    peakCost: null, cost70: null, cost90: null, sampleCount: valid.length,
  };
  const traded = valid.filter((bar) => bar.volume > 0);
  if (!traded.length || lastClose == null) return empty;

  const min = traded.reduce((value, bar) => Math.min(value, bar.low), Infinity);
  const max = traded.reduce((value, bar) => Math.max(value, bar.high), -Infinity);
  const span = max - min;
  const limit = Number.isFinite(maxBins) ? Math.max(1, Math.min(256, Math.floor(maxBins))) : 80;
  const count = span === 0 ? 1 : Number.isFinite(priceStep) && priceStep > 0
    ? Math.min(limit, Math.max(1, Math.ceil(span / priceStep))) : limit;
  const step = span / count;
  const retention = Number.isFinite(decay) ? Math.min(1, Math.max(0, decay)) : 0.95;
  const bins = Array.from({ length: count }, () => ({ volume: 0, profitVolume: 0, moment: 0, low: Infinity, high: -Infinity }));
  const indexAt = (price: number) => step > 0 ? Math.max(0, Math.min(count - 1, Math.floor((price - min) / step))) : 0;

  for (let index = 0; index < valid.length; index++) {
    const bar = valid[index];
    const volume = bar.volume * retention ** (valid.length - 1 - index);
    if (volume === 0) continue;
    const first = indexAt(bar.low);
    const last = indexAt(bar.high);
    for (let binIndex = first; binIndex <= last; binIndex++) {
      const low = Math.max(bar.low, min + binIndex * step);
      const high = Math.min(bar.high, binIndex === count - 1 ? max : min + (binIndex + 1) * step);
      const flat = bar.high === bar.low;
      if (!flat && high <= low) continue;
      // 用价格区间交集分配成交量，避免旧版 steps + 1 次累加导致成交量凭空增加。
      const portion = flat ? volume : volume * (high - low) / (bar.high - bar.low);
      const profit = flat ? (bar.close <= lastClose ? portion : 0)
        : portion * Math.max(0, Math.min(high, lastClose) - low) / (high - low);
      const bin = bins[binIndex];
      bin.volume += portion;
      bin.profitVolume += profit;
      bin.moment += portion * (low + (high - low) / 2);
      bin.low = Math.min(bin.low, low);
      bin.high = Math.max(bin.high, high);
    }
  }

  const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
  if (!(totalVolume > 0) || !Number.isFinite(totalVolume)) return empty;
  const chips: ChipBar[] = bins.filter((bin) => bin.volume > 0).map((bin) => ({
    price: bin.moment / bin.volume, low: bin.low, high: bin.high,
    volume: bin.volume, profitVolume: bin.profitVolume, percent: bin.volume / totalVolume * 100,
  }));
  if (chips.some((chip) => !Number.isFinite(chip.price))) return empty;

  const quantile = (fraction: number) => {
    const target = totalVolume * fraction;
    let cumulative = 0;
    for (const chip of chips) {
      if (cumulative + chip.volume >= target) {
        return chip.low + (chip.high - chip.low) * Math.min(1, Math.max(0, (target - cumulative) / chip.volume));
      }
      cumulative += chip.volume;
    }
    return chips[chips.length - 1].high;
  };
  return {
    chips, totalVolume, lastClose, sampleCount: valid.length,
    profitRatio: Math.min(100, Math.max(0, chips.reduce((sum, chip) => sum + chip.profitVolume, 0) / totalVolume * 100)),
    averageCost: chips.reduce((sum, chip) => sum + chip.price * (chip.volume / totalVolume), 0),
    peakCost: chips.reduce((peak, chip) => chip.volume > peak.volume ? chip : peak).price,
    cost70: [quantile(0.15), quantile(0.85)],
    cost90: [quantile(0.05), quantile(0.95)],
  };
}
