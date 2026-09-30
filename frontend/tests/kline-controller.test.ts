import assert from "node:assert/strict";
import { test } from "node:test";
import { KLineController } from "../src/lib/kline-controller";
import type { CandlestickItem, CandlesticksResponse } from "../src/types/app";

const candle = (close: string): CandlestickItem => ({ timestamp: 1, open: "10", high: "20", low: "10", close, volume: "100", turnover: "1000" });
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const requests: { symbol: string; period: string; count: number; signal: AbortSignal; resolve: (response: CandlesticksResponse) => void; reject: (reason: Error) => void }[] = [];
  const controller = new KLineController((symbol, period, count, init) => new Promise((resolve, reject) => {
    requests.push({ symbol, period, count, signal: init.signal!, resolve, reject });
  }));
  return { controller, requests, respond: (index: number, close: string, count = 1) => requests[index].resolve({ symbol: requests[index].symbol, period: requests[index].period, bars: Array.from({ length: count }, () => candle(close)) } as CandlesticksResponse) };
}

test("switching symbol or period clears old samples and ignores late results even if abort is ignored", async () => {
  const { controller, requests, respond } = fixture();
  controller.activate("AAPL.US", "1D");
  respond(0, "12"); await flush();
  controller.loadMore();
  assert.equal(requests[1].count, 700);
  controller.activate("MSFT.US", "1W");
  assert.ok(requests[1].signal.aborted);
  assert.deepEqual(controller.snapshot().bars, []);
  respond(2, "18"); await flush();
  respond(1, "13", 700); await flush();
  assert.equal(controller.snapshot().symbol, "MSFT.US");
  assert.equal(controller.snapshot().period, "1W");
  assert.equal(controller.snapshot().bars[0].close, "18");
});

test("same-timestamp close and volume corrections reach the chart and chip sample", async () => {
  const { controller, requests, respond } = fixture();
  controller.activate("AAPL.US", "1D"); respond(0, "12"); await flush();
  controller.refresh(); controller.refresh();
  assert.equal(requests.length, 2, "Concurrent edge notifications must share a single read");
  requests[1].resolve({ symbol: "AAPL.US", period: "1D", bars: [{ ...candle("19"), volume: "250" }] }); await flush();
  assert.equal(controller.snapshot().bars[0].close, "19");
  assert.equal(controller.snapshot().bars[0].volume, "250");
});

test("failed initial reads can recover and exhausted history stops duplicate pagination", async () => {
  const { controller, requests, respond } = fixture();
  controller.activate("AAPL.US", "1D"); requests[0].reject(new Error("unavailable")); await flush();
  assert.equal(controller.snapshot().loading, false);
  assert.deepEqual(controller.snapshot().bars, []);
  controller.refresh(); respond(1, "15", 500); await flush();
  controller.loadMore(); respond(2, "15", 500); await flush();
  controller.loadMore();
  assert.equal(requests.length, 3);
  assert.equal(controller.snapshot().bars.length, 500);
});

test("StrictMode disposal discards old reads; failures preserve loaded history", async () => {
  const { controller, requests, respond } = fixture();
  controller.activate("AAPL.US", "1D"); controller.dispose(); controller.activate("AAPL.US", "1D");
  respond(1, "15"); await flush(); respond(0, "11"); await flush();
  assert.equal(controller.snapshot().bars[0].close, "15");
  controller.refresh(); requests[2].reject(new Error("unavailable")); await flush();
  assert.equal(controller.snapshot().bars[0].close, "15");
  assert.equal(controller.snapshot().loading, false);
});
