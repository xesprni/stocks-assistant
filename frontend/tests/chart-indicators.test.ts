import assert from "node:assert/strict";
import { test } from "node:test";
import { calcATR, calcMA, calcOBV, calcROC } from "../src/lib/indicators";

test("ATR includes overnight gaps and uses Wilder smoothing after the seed", () => {
  const values = calcATR([11, 15, 14, 16, 17], [9, 12, 11, 13, 14], [10, 14, 12, 15, 16], 3);
  assert.deepEqual(values.slice(0, 3), [null, null, null]);
  assert.equal(values[3], 4); // TR = 5, 3, 4
  assert.ok(Math.abs(values[4]! - 11 / 3) < 1e-12);
  assert.deepEqual(calcATR([11], [9], [10]), [null]);
  assert.deepEqual(calcATR([], [], []), []);
});

test("OBV adds rising volume, subtracts falling volume and ignores unchanged closes", () => {
  assert.deepEqual(calcOBV([10, 12, 12, 9, 11], [100, 20, 500, 30, 7]), [0, 20, 20, -10, -3]);
  assert.deepEqual(calcOBV([], []), []);
  assert.deepEqual(calcOBV([10, 12], [100, NaN]), [0, null]);
});

test("ROC warmup and zero denominators never produce misleading values", () => {
  assert.deepEqual(calcROC([10, 12, 15, 6], 2), [null, null, 50, -50]);
  assert.deepEqual(calcROC([0, 10], 1), [null, null]);
  assert.deepEqual(calcROC([10, 10], 1), [null, 0]);
  assert.deepEqual(calcROC([1, 2], 0), [null, null]);
  assert.deepEqual(calcMA([10, 20, 30, 40], 3), [null, null, 20, 30]);
});

test("MA60, MA120 and MA250 use complete rolling windows and leave short history blank", () => {
  const closes = Array.from({ length: 500 }, (_, index) => index + 1);
  for (const period of [60, 120, 250]) {
    const values = calcMA(closes, period);
    assert.ok(values.slice(0, period - 1).every((value) => value === null));
    assert.equal(values[period - 1], (period + 1) / 2);
    assert.equal(values.at(-1), (501 - period + 500) / 2);
    assert.deepEqual(calcMA(closes.slice(0, period - 1), period), Array(period - 1).fill(null));
  }
});
