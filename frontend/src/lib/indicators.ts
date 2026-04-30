/** Technical indicator calculations — all operate on plain number arrays. */

export interface MACDPoint {
  macd: number;
  signal: number;
  histogram: number;
}

export interface KDJPoint {
  k: number;
  d: number;
  j: number;
}

export interface BollingerPoint {
  upper: number;
  middle: number;
  lower: number;
}

export interface BBIBOLLPoint {
  upper: number;
  middle: number;
  lower: number;
}

export interface DMIPoint {
  pdi: number;
  mdi: number;
  adx: number;
  adxr: number;
}

export interface OSCPoint {
  dif: number;
  dea: number;
  osc: number;
}

// ── Moving Averages ───────────────────────────────────────────────────────────

export function calcMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    result[i] = sum / period;
  }
  return result;
}

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length).fill(0);
  // seed with simple mean of first `period` values
  let seed = 0;
  for (let i = 0; i < Math.min(period, values.length); i++) seed += values[i];
  result[Math.min(period - 1, values.length - 1)] = seed / Math.min(period, values.length);
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── MACD (12, 26, 9) ─────────────────────────────────────────────────────────

export function calcMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): (MACDPoint | null)[] {
  if (closes.length < slowPeriod) return closes.map(() => null);
  const ema12 = calcEMA(closes, fastPeriod);
  const ema26 = calcEMA(closes, slowPeriod);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  // Signal EMA is computed only from index (slowPeriod - 1) onward
  const signalLine = calcEMA(macdLine.slice(slowPeriod - 1), signalPeriod);
  const result: (MACDPoint | null)[] = closes.map(() => null);
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    const signal = signalLine[i - (slowPeriod - 1)];
    const macd = macdLine[i];
    result[i] = { macd, signal, histogram: macd - signal };
  }
  return result;
}

// ── KDJ (9, 3, 3) ────────────────────────────────────────────────────────────

export function calcKDJ(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 9,
): (KDJPoint | null)[] {
  const n = closes.length;
  if (n < period) return closes.map(() => null);
  const result: (KDJPoint | null)[] = closes.map(() => null);
  let k = 50;
  let d = 50;
  for (let i = period - 1; i < n; i++) {
    const rangeHigh = Math.max(...highs.slice(i - period + 1, i + 1));
    const rangeLow = Math.min(...lows.slice(i - period + 1, i + 1));
    const rsv = rangeHigh === rangeLow ? 50 : ((closes[i] - rangeLow) / (rangeHigh - rangeLow)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    result[i] = { k, d, j };
  }
  return result;
}

// ── RSI (14) ─────────────────────────────────────────────────────────────────

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const n = closes.length;
  if (n < period + 1) return closes.map(() => null);
  const result: (number | null)[] = closes.map(() => null);
  let avgGain = 0;
  let avgLoss = 0;
  // first average
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// ── Bollinger Bands (20, 2) ───────────────────────────────────────────────────

export function calcBollinger(
  closes: number[],
  period = 20,
  multiplier = 2,
): (BollingerPoint | null)[] {
  const n = closes.length;
  const result: (BollingerPoint | null)[] = closes.map(() => null);
  for (let i = period - 1; i < n; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    result[i] = {
      upper: mean + multiplier * std,
      middle: mean,
      lower: mean - multiplier * std,
    };
  }
  return result;
}

// ── CCI (Commodity Channel Index, 20) ────────────────────────────────────────

export function calcCCI(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = closes.map(() => null);
  for (let i = period - 1; i < n; i++) {
    const typical: number[] = [];
    for (let j = i - period + 1; j <= i; j++) {
      typical.push((closes[j] + highs[j] + lows[j]) / 3);
    }
    const mean = typical.reduce((a, b) => a + b, 0) / period;
    const md = typical.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    result[i] = md === 0 ? 0 : (typical[period - 1] - mean) / (0.015 * md);
  }
  return result;
}

// ── Williams %R (14) ─────────────────────────────────────────────────────────

export function calcWR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = closes.map(() => null);
  for (let i = period - 1; i < n; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    result[i] = hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
  }
  return result;
}

// ── EMA overlay (exponential moving average, reusable) ─────────────────────────

export function calcEMAValues(values: number[], period: number): (number | null)[] {
  if (values.length < period) return values.map(() => null);
  const result: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1]! * (1 - k);
  }
  return result;
}

// ── BBIBOLL (BBI Bollinger Bands, 3/6/12/24 BBI + 3.0 multiplier) ──────────────

export function calcBBIBOLL(
  closes: number[],
  periods = [3, 6, 12, 24],
  multiplier = 3.0,
): (BBIBOLLPoint | null)[] {
  const n = closes.length;
  const result: (BBIBOLLPoint | null)[] = closes.map(() => null);
  const maxP = Math.max(...periods);
  for (let i = maxP - 1; i < n; i++) {
    let bbi = 0;
    let valid = true;
    for (const p of periods) {
      if (i < p - 1) { valid = false; break; }
      let s = 0;
      for (let j = 0; j < p; j++) s += closes[i - j];
      bbi += s / p;
    }
    if (!valid) continue;
    bbi /= periods.length;
    // standard deviation of close over last 11 bars
    const sdLen = 11;
    const slice = closes.slice(i - sdLen + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / sdLen;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / sdLen);
    result[i] = {
      upper: bbi + multiplier * std,
      middle: bbi,
      lower: bbi - multiplier * std,
    };
  }
  return result;
}

// ── DMI (Directional Movement Index, 14) ────────────────────────────────────────

export function calcDMI(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (DMIPoint | null)[] {
  const n = closes.length;
  const result: (DMIPoint | null)[] = closes.map(() => null);
  if (n < period + 1) return result;

  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }

  // Wilder smoothing
  const smoothPDM: number[] = new Array(n).fill(0);
  const smoothMDM: number[] = new Array(n).fill(0);
  const smoothTR: number[] = new Array(n).fill(0);

  let sp = 0, sm = 0, st = 0;
  for (let i = 1; i <= period; i++) { sp += plusDM[i]; sm += minusDM[i]; st += tr[i]; }
  smoothPDM[period] = sp;
  smoothMDM[period] = sm;
  smoothTR[period] = st;

  for (let i = period + 1; i < n; i++) {
    smoothPDM[i] = smoothPDM[i - 1] - smoothPDM[i - 1] / period + plusDM[i];
    smoothMDM[i] = smoothMDM[i - 1] - smoothMDM[i - 1] / period + minusDM[i];
    smoothTR[i] = smoothTR[i - 1] - smoothTR[i - 1] / period + tr[i];
  }

  const pdi: number[] = new Array(n).fill(0);
  const mdi: number[] = new Array(n).fill(0);
  const dx: number[] = new Array(n).fill(0);

  for (let i = period; i < n; i++) {
    pdi[i] = smoothTR[i] === 0 ? 0 : (smoothPDM[i] / smoothTR[i]) * 100;
    mdi[i] = smoothTR[i] === 0 ? 0 : (smoothMDM[i] / smoothTR[i]) * 100;
    dx[i] = pdi[i] + mdi[i] === 0 ? 0 : Math.abs(pdi[i] - mdi[i]) / (pdi[i] + mdi[i]) * 100;
  }

  // ADX = smoothed DX
  const adx: number[] = new Array(n).fill(0);
  let adxSum = 0;
  for (let i = period; i < Math.min(period * 2 - 1, n); i++) {
    adxSum += dx[i];
  }
  if (period * 2 - 2 < n) {
    adx[period * 2 - 2] = adxSum / period;
  }
  for (let i = period * 2 - 1; i < n; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }

  // ADXR
  const adxr: number[] = new Array(n).fill(0);
  for (let i = period * 2 - 2 + period; i < n; i++) {
    adxr[i] = (adx[i] + adx[i - period]) / 2;
  }

  for (let i = period * 2 - 2; i < n; i++) {
    result[i] = { pdi: pdi[i], mdi: mdi[i], adx: adx[i], adxr: adxr[i] };
  }

  return result;
}

// ── OSC (Oscillator, same as MACD but returns dif/dea/osc naming) ──────────────

export function calcOSC(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): (OSCPoint | null)[] {
  if (closes.length < slowPeriod) return closes.map(() => null);
  const ema12 = calcEMA(closes, fastPeriod);
  const ema26 = calcEMA(closes, slowPeriod);
  const difLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const deaLine = calcEMA(difLine.slice(slowPeriod - 1), signalPeriod);
  const result: (OSCPoint | null)[] = closes.map(() => null);
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    const dea = deaLine[i - (slowPeriod - 1)];
    const dif = difLine[i];
    result[i] = { dif, dea, osc: dif - dea };
  }
  return result;
}

// ── Chip Distribution (simplified volume-based cost distribution) ───────────────

export interface ChipBar {
  price: number;
  volume: number;
  percent: number;
}

export function calcChipDistribution(
  bars: { high: number; low: number; close: number; volume: number }[],
  priceStep: number,
  decay = 0.95,
  maxBins = 60,
): { chips: ChipBar[]; profitRatio: number } {
  if (bars.length === 0) return { chips: [], profitRatio: 0 };

  const lastClose = bars[bars.length - 1].close;

  let minP = Infinity, maxP = -Infinity;
  for (const b of bars) {
    if (b.low < minP) minP = b.low;
    if (b.high > maxP) maxP = b.high;
  }
  minP = Math.floor(minP / priceStep) * priceStep;
  maxP = Math.ceil(maxP / priceStep) * priceStep;

  let rawBins = Math.max(1, Math.round((maxP - minP) / priceStep) + 1);

  // Aggregate if too many bins: merge groups into fewer slots
  let groupSize = 1;
  if (rawBins > maxBins) {
    groupSize = Math.ceil(rawBins / maxBins);
    rawBins = Math.ceil(rawBins / groupSize);
  }
  const step = priceStep * groupSize;
  const adjMin = minP;

  const dist = new Float64Array(rawBins);

  for (let bi = 0; bi < bars.length; bi++) {
    const b = bars[bi];
    const weight = Math.pow(decay, bars.length - 1 - bi);
    const lo = Math.max(b.low, adjMin);
    const hi = Math.min(b.high, maxP);
    const span = hi - lo;
    if (span <= 0) {
      const idx = Math.min(Math.floor((lo - adjMin) / step), rawBins - 1);
      if (idx >= 0 && idx < rawBins) dist[idx] += b.volume * weight;
    } else {
      const steps = Math.max(1, Math.round(span / step));
      const perStep = b.volume * weight / steps;
      for (let s = 0; s <= steps; s++) {
        const p = lo + (span * s) / steps;
        const idx = Math.min(Math.floor((p - adjMin) / step), rawBins - 1);
        if (idx >= 0 && idx < rawBins) dist[idx] += perStep;
      }
    }
  }

  const totalVol = dist.reduce((a, b) => a + b, 0);
  if (totalVol === 0) return { chips: [], profitRatio: 0 };

  const chips: ChipBar[] = [];
  let profitableVol = 0;
  for (let i = 0; i < rawBins; i++) {
    if (dist[i] === 0) continue;
    const price = adjMin + i * step + step / 2; // center of bin
    const percent = (dist[i] / totalVol) * 100;
    chips.push({ price, volume: dist[i], percent });
    if (price <= lastClose) profitableVol += dist[i];
  }

  return {
    chips,
    profitRatio: totalVol > 0 ? (profitableVol / totalVol) * 100 : 0,
  };
}

// ── Support & Resistance ───────────────────────────────────────────────────────

export interface SupportResistanceLevel {
  price: number;
  type: "support" | "resistance";
  strength: number; // 1-5, how many touches/confluences
  label: string;
}

/**
 * Calculate support and resistance levels using a combined approach:
 *
 * 1. Pivot Points (classic S1/S2/R1/R2) from the most recent bar
 * 2. Historical local extrema clustering — find swing highs/lows,
 *    cluster nearby price levels, and score by number of touches
 *
 * This is the most robust approach because:
 * - Pivot points give clean mathematical levels from the latest price action
 * - Historical clustering captures real market structure (where price reversed before)
 * - Strength scoring prioritizes levels with multiple touches (market memory)
 */
export function calcSupportResistance(
  bars: { high: number; low: number; close: number }[],
  maxLevels = 8,
): SupportResistanceLevel[] {
  if (bars.length < 5) return [];

  const lastBar = bars[bars.length - 1];
  const levels: SupportResistanceLevel[] = [];

  // ── 1. Classic Pivot Points ──
  const pivot = (lastBar.high + lastBar.low + lastBar.close) / 3;
  const r1 = 2 * pivot - lastBar.low;
  const s1 = 2 * pivot - lastBar.high;
  const r2 = pivot + (lastBar.high - lastBar.low);
  const s2 = pivot - (lastBar.high - lastBar.low);

  const currentPrice = lastBar.close;
  const atr = calcATR(bars.map((b) => b.high), bars.map((b) => b.low), bars.map((b) => b.close), 14);
  const avgATR = atr.filter((v) => v != null).pop() ?? (lastBar.high - lastBar.low);
  const tolerance = avgATR * 0.15; // cluster tolerance = 15% of ATR

  // ── 2. Find local extrema ──
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  const lookback = 5;

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) isHigh = false;
      if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) isLow = false;
    }
    if (isHigh) swingHighs.push(bars[i].high);
    if (isLow) swingLows.push(bars[i].low);
  }

  // ── 3. Cluster nearby levels ──
  function clusterPrices(prices: number[], tol: number): { price: number; count: number }[] {
    if (prices.length === 0) return [];
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters: { sum: number; count: number }[] = [{ sum: sorted[0], count: 1 }];

    for (let i = 1; i < sorted.length; i++) {
      const avg = clusters[clusters.length - 1].sum / clusters[clusters.length - 1].count;
      if (Math.abs(sorted[i] - avg) <= tol) {
        clusters[clusters.length - 1].sum += sorted[i];
        clusters[clusters.length - 1].count++;
      } else {
        clusters.push({ sum: sorted[i], count: 1 });
      }
    }
    return clusters.map((c) => ({ price: c.sum / c.count, count: c.count }));
  }

  const resistClusters = clusterPrices(swingHighs, tolerance)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const supportClusters = clusterPrices(swingLows, tolerance)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // ── 4. Build levels with confluence scoring ──
  // Collect all candidate prices and score them
  const candidateMap = new Map<number, { type: "support" | "resistance"; score: number; sources: string[] }>();

  function addCandidate(price: number, type: "support" | "resistance", source: string, baseScore: number) {
    // Check if this price is close to an existing candidate
    for (const [key, val] of candidateMap) {
      if (Math.abs(key - price) <= tolerance) {
        // Merge — upgrade type if confluent
        const mergedType = val.type === type ? type : (price < currentPrice ? "support" : "resistance");
        val.type = mergedType;
        val.score += baseScore;
        if (!val.sources.includes(source)) val.sources.push(source);
        return;
      }
    }
    candidateMap.set(price, { type, score: baseScore, sources: [source] });
  }

  // Pivot point levels
  addCandidate(s1, s1 < currentPrice ? "support" : "resistance", "Pivot S1", 2);
  addCandidate(s2, s2 < currentPrice ? "support" : "resistance", "Pivot S2", 1);
  addCandidate(r1, r1 < currentPrice ? "support" : "resistance", "Pivot R1", 2);
  addCandidate(r2, r2 < currentPrice ? "support" : "resistance", "Pivot R2", 1);

  // Historical clusters
  for (const c of resistClusters) {
    addCandidate(c.price, "resistance", `Swing High ×${c.count}`, Math.min(c.count, 5));
  }
  for (const c of supportClusters) {
    addCandidate(c.price, "support", `Swing Low ×${c.count}`, Math.min(c.count, 5));
  }

  // Sort by score descending, take top levels
  const sorted = [...candidateMap.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, maxLevels);

  // Final classification based on current price
  for (const [price, info] of sorted) {
    const type = price < currentPrice ? "support" : "resistance";
    levels.push({
      price,
      type,
      strength: Math.min(info.score, 5),
      label: info.sources.join(" + "),
    });
  }

  // Sort by price for display
  return levels.sort((a, b) => a.price - b.price);
}

// ── ATR (Average True Range, 14) ──────────────────────────────────────────────

function calcATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  result[period] = sum / period;

  for (let i = period + 1; i < n; i++) {
    result[i] = (result[i - 1]! * (period - 1) + tr[i]) / period;
  }
  return result;
}
