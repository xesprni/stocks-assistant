import assert from "node:assert/strict";
import { test } from "node:test";
import { calcChipDistribution } from "../src/lib/chip-distribution";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("uniform volume conserves mass and gives analytical mean, profit and cost intervals", () => {
  const result = calcChipDistribution([{ low: 10, high: 20, close: 15, volume: 100 }], 1, 1);
  near(result.totalVolume, 100);
  near(result.chips.reduce((sum, chip) => sum + chip.percent, 0), 100);
  near(result.averageCost!, 15);
  near(result.profitRatio!, 50);
  assert.deepEqual(result.cost70, [11.5, 18.5]);
  assert.deepEqual(result.cost90, [10.5, 19.5]);
});

test("profit crossing a price bin is prorated instead of classified by its center", () => {
  const result = calcChipDistribution([{ low: 10, high: 20, close: 11, volume: 100 }], 10, 1);
  assert.equal(result.chips.length, 1);
  near(result.chips[0].profitVolume, 10);
  near(result.profitRatio!, 10);
});

test("flat sessions and a single price keep their actual cost, including breakeven", () => {
  const result = calcChipDistribution([{ low: 10, high: 10, close: 10, volume: 100 }]);
  assert.equal(result.chips.length, 1);
  assert.equal(result.chips[0].price, 10);
  assert.equal(result.averageCost, 10);
  assert.equal(result.profitRatio, 100);
  assert.deepEqual(result.cost70, [10, 10]);
  assert.deepEqual(result.cost90, [10, 10]);
});

test("decay changes weights without inventing volume; a zero-volume latest bar still supplies the reference price", () => {
  const result = calcChipDistribution([
    { low: 10, high: 10, close: 10, volume: 100 },
    { low: 20, high: 20, close: 20, volume: 100 },
    { low: 15, high: 15, close: 15, volume: 0 },
  ], 1, 0.5);
  near(result.totalVolume, 75);
  near(result.averageCost!, 50 / 3);
  near(result.profitRatio!, 100 / 3);
  assert.equal(result.lastClose, 15);
  assert.equal(result.peakCost, 20);
  assert.deepEqual(result.cost90, [10, 20]);
});

test("empty and invalid samples never produce NaN or a false 100% loss ratio", () => {
  for (const bars of [[], [{ low: 10, high: 20, close: 15, volume: 0 }], [
    { low: NaN, high: 20, close: 15, volume: 10 },
    { low: 20, high: 10, close: 15, volume: 10 },
    { low: 10, high: 20, close: Infinity, volume: 10 },
    { low: 10, high: 20, close: 15, volume: -10 },
    { low: 10, high: 20, close: 30, volume: 10 },
  ]]) {
    const result = calcChipDistribution(bars);
    assert.deepEqual(result.chips, []);
    assert.equal(result.profitRatio, null);
    assert.equal(result.averageCost, null);
    assert.equal(result.cost90, null);
  }
});

test("bin limits, wide price gaps and tiny prices remain bounded and normalized", () => {
  for (const scale of [0.00001, 1, 100000]) {
    const bars = [
      { low: scale, high: 2 * scale, close: 1.5 * scale, volume: 100 },
      { low: 100 * scale, high: 120 * scale, close: 110 * scale, volume: 300 },
    ];
    const copy = structuredClone(bars);
    const result = calcChipDistribution(bars, 0.00000001, 1, 32);
    assert.ok(result.chips.length <= 32);
    assert.deepEqual(bars, copy);
    near(result.totalVolume, 400);
    near(result.profitRatio!, 62.5);
    assert.ok(result.chips.every((chip) => Number.isFinite(chip.price) && chip.volume >= 0 && chip.high >= chip.low));
    assert.ok(result.cost90![0] <= result.cost70![0] && result.cost70![1] <= result.cost90![1]);
  }
  const bar = [{ low: 10, high: 20, close: 15, volume: 100 }];
  assert.ok(calcChipDistribution(bar, 0, NaN, Infinity).chips.length <= 80);
  assert.equal(calcChipDistribution(bar, -1, 1, 0).chips.length, 1);
});
