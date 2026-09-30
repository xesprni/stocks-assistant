import assert from "node:assert/strict";
import { test } from "node:test";
import { CompanyPositionController } from "../src/lib/company-position-controller";
import type { PortfolioItem, PortfolioListResponse } from "../src/types/app";

const response = (symbol: string) => ({ items: [{ symbol } as PortfolioItem] } as PortfolioListResponse);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("changing companies rejects late holdings from the previous market", async () => {
  let resolveOld!: (value: PortfolioListResponse) => void;
  let oldSignal: AbortSignal | null | undefined;
  const controller = new CompanyPositionController((market, init) => {
    if (market === "US") {
      oldSignal = init.signal;
      return new Promise((resolve) => { resolveOld = resolve; });
    }
    assert.equal(market, "H");
    return Promise.resolve(response("700.HK"));
  });
  controller.activate("AAPL.US");
  controller.activate("700.HK");
  await tick();
  resolveOld(response("AAPL.US"));
  await tick();
  assert.equal(oldSignal?.aborted, true);
  assert.equal(controller.snapshot().position?.symbol, "700.HK");
  controller.dispose();
});

test("StrictMode restart ignores an aborted failure and handles an absent position", async () => {
  let rejectOld!: (error: Error) => void;
  let calls = 0;
  const controller = new CompanyPositionController(async (market) => {
    assert.equal(market, "A");
    if (++calls === 1) return new Promise((_, reject) => { rejectOld = reject; });
    return response("600000.SH");
  });
  controller.activate("600519.SH");
  controller.dispose();
  controller.activate("600519.SH");
  rejectOld(new Error("Old request failed"));
  await tick();
  assert.deepEqual(controller.snapshot(), { position: null, loading: false, error: "" });
  controller.dispose();
});
