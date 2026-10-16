import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeTargetSeconds } from "./target-seconds.js";

// small seeded PRNG so the property test is repeatable
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = Date.UTC(2026, 2, 10, 9, 0, 0);

// every test runs with the system clock set to a moment unrelated to the test data
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("1999-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("computeTargetSeconds", () => {
  it.each([
    ["long before the start", 0, START - 3_600_000],
    ["1 ms before the start", 0, START - 1],
    ["exactly at the start", 0, START],
    ["1500 ms after the start", 1.5, START + 1500],
    ["1 ms after the start", 0.001, START + 1],
    ["half way", 30, START + 30_000],
    ["exactly the duration", 60, START + 60_000],
    ["1 ms past the duration", 60, START + 60_001],
    ["long after the end", 60, START + 86_400_000],
  ])("%s gives %s seconds of a 60 second video", (_name, expected, now) => {
    expect(computeTargetSeconds(now, START, 60)).toBe(expected);
  });

  it("does not round", () => {
    expect(computeTargetSeconds(START + 1234, START, 60)).toBe(1.234);
  });

  it("always gives 0 for a duration of 0", () => {
    for (const now of [START - 5000, START, START + 5000]) expect(computeTargetSeconds(now, START, 0)).toBe(0);
  });

  it.each([
    ["serverNowMs is NaN", Number.NaN, START, 60],
    ["serverNowMs is Infinity", Number.POSITIVE_INFINITY, START, 60],
    ["serverNowMs is -Infinity", Number.NEGATIVE_INFINITY, START, 60],
    ["startsAtMs is NaN", START, Number.NaN, 60],
    ["startsAtMs is Infinity", START, Number.POSITIVE_INFINITY, 60],
    ["durationSeconds is NaN", START, START, Number.NaN],
    ["durationSeconds is Infinity", START, START, Number.POSITIVE_INFINITY],
    ["durationSeconds is negative", START, START, -1],
    ["durationSeconds is slightly negative", START, START, -0.001],
  ])("throws RangeError when %s", (_name, now, start, duration) => {
    expect(() => computeTargetSeconds(now, start, duration)).toThrow(RangeError);
  });

  it("does not depend on the system clock", () => {
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = computeTargetSeconds(START + 4000, START, 60);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(computeTargetSeconds(START + 4000, START, 60)).toBe(first);
  });

  it("stays within [0, durationSeconds] and never decreases as now moves forward (seeded, repeatable)", () => {
    const random = mulberry32(20261022);
    const failures: string[] = [];
    let atZero = 0;
    let atCap = 0;
    for (let i = 0; i < 500; i++) {
      const duration = Math.floor(random() * 7200);
      const start = START + Math.floor(random() * 1_000_000);
      const nows = Array.from({ length: 40 }, () => start - 100_000 + Math.floor(random() * (duration * 1000 + 200_000))).sort((a, b) => a - b);
      let previous = -Infinity;
      for (const now of nows) {
        const value = computeTargetSeconds(now, start, duration);
        if (value < 0 || value > duration || value < previous) failures.push(`${now} ${start} ${duration}`);
        if (value === 0) atZero++;
        if (value === duration) atCap++;
        previous = value;
      }
    }
    expect(failures).toEqual([]);
    expect(atZero).toBeGreaterThan(100); // the lower clamp is exercised
    expect(atCap).toBeGreaterThan(100); // the upper clamp is exercised
  });
});
