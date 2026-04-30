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
