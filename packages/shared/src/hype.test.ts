import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeHypeBase, computeHypeTarget, defaultHypeConfig, hypeConfigSchema, seededJitter, seededRandom, type HypeConfig } from "./hype.js";

// small seeded PRNG so the property tests are repeatable
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_32 = 4294967296;
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";

type Pair = [minute: number, count: number];
const cfg = (base: number, pairs: Pair[], jitterPercent = 0, jitterIntervalSeconds = 10): HypeConfig => ({
  base,
  nodes: pairs.map(([minute, count]) => ({ minute, count })),
  jitterPercent,
  jitterIntervalSeconds,
});

// every test runs with the system clock set to a moment unrelated to the test data
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("1999-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("hypeConfigSchema", () => {
  const parse = (input: unknown) => hypeConfigSchema.safeParse(input);
  const nodesOf = (count: number) => Array.from({ length: count }, (_, i) => ({ minute: i + 1, count: i }));
  const full = { base: 100, nodes: [{ minute: 5, count: 180 }, { minute: 30, count: 260 }], jitterPercent: 10, jitterIntervalSeconds: 10 };

  it("accepts a complete configuration unchanged", () => {
    expect(parse(full)).toEqual({ success: true, data: full });
  });

  it("turns {} into the complete default configuration", () => {
    expect(parse({})).toEqual({ success: true, data: { base: 0, nodes: [], jitterPercent: 0, jitterIntervalSeconds: 10 } });
    expect(parse({}).data).toEqual(defaultHypeConfig);
  });

  it("fills in only the missing fields", () => {
    expect(parse({ base: 5 }).data).toEqual({ base: 5, nodes: [], jitterPercent: 0, jitterIntervalSeconds: 10 });
  });

  it("exports a default configuration that cannot be changed by accident", () => {
    expect(defaultHypeConfig).toEqual({ base: 0, nodes: [], jitterPercent: 0, jitterIntervalSeconds: 10 });
    expect(Object.isFrozen(defaultHypeConfig)).toBe(true);
    expect(Object.isFrozen(defaultHypeConfig.nodes)).toBe(true);
  });

  it.each([
    ["base 0", { base: 0 }],
    ["base 1000000", { base: 1_000_000 }],
    ["node minute 1", { nodes: [{ minute: 1, count: 5 }] }],
    ["node minute 1440", { nodes: [{ minute: 1440, count: 5 }] }],
    ["node count 0", { nodes: [{ minute: 1, count: 0 }] }],
    ["node count 1000000", { nodes: [{ minute: 1, count: 1_000_000 }] }],
    ["100 nodes", { nodes: nodesOf(100) }],
    ["jitterPercent 0", { jitterPercent: 0 }],
    ["jitterPercent 100", { jitterPercent: 100 }],
    ["jitterIntervalSeconds 1", { jitterIntervalSeconds: 1 }],
    ["jitterIntervalSeconds 300", { jitterIntervalSeconds: 300 }],
  ])("accepts %s", (_name, input) => {
    expect(parse(input).success).toBe(true);
  });

  it.each([
    ["base -1", { base: -1 }],
    ["base 1.5", { base: 1.5 }],
    ["base 1000001", { base: 1_000_001 }],
    ["base as a string", { base: "5" }],
    ["base NaN", { base: Number.NaN }],
    ["base Infinity", { base: Number.POSITIVE_INFINITY }],
    ["base null", { base: null }],
    ["node minute 0", { nodes: [{ minute: 0, count: 5 }] }],
    ["node minute 1.5", { nodes: [{ minute: 1.5, count: 5 }] }],
    ["node minute 1441", { nodes: [{ minute: 1441, count: 5 }] }],
    ["node minute negative", { nodes: [{ minute: -1, count: 5 }] }],
    ["node minutes equal", { nodes: [{ minute: 5, count: 1 }, { minute: 5, count: 2 }] }],
    ["node minutes decreasing", { nodes: [{ minute: 10, count: 1 }, { minute: 5, count: 2 }] }],
    ["node minutes not increasing later on", { nodes: [{ minute: 1, count: 1 }, { minute: 2, count: 2 }, { minute: 2, count: 3 }] }],
    ["node count -1", { nodes: [{ minute: 1, count: -1 }] }],
    ["node count 1.5", { nodes: [{ minute: 1, count: 1.5 }] }],
    ["node count 1000001", { nodes: [{ minute: 1, count: 1_000_001 }] }],
    ["node without count", { nodes: [{ minute: 1 }] }],
    ["node without minute", { nodes: [{ count: 1 }] }],
    ["unknown field in a node", { nodes: [{ minute: 1, count: 1, extra: 1 }] }],
    ["101 nodes", { nodes: nodesOf(101) }],
    ["nodes not an array", { nodes: {} }],
    ["jitterPercent -1", { jitterPercent: -1 }],
    ["jitterPercent 101", { jitterPercent: 101 }],
    ["jitterPercent 10.5", { jitterPercent: 10.5 }],
    ["jitterIntervalSeconds 0", { jitterIntervalSeconds: 0 }],
    ["jitterIntervalSeconds 301", { jitterIntervalSeconds: 301 }],
    ["jitterIntervalSeconds 1.5", { jitterIntervalSeconds: 1.5 }],
    ["jitterIntervalSeconds -1", { jitterIntervalSeconds: -1 }],
    ["an unknown field", { extra: 1 }],
    ["null", null],
    ["a number", 5],
    ["a string", "x"],
    ["an array", []],
    ["undefined", undefined],
  ])("rejects %s", (_name, input) => {
    expect(parse(input).success).toBe(false);
  });

  it("does not modify the input", () => {
    const input = Object.freeze({ base: 1, nodes: Object.freeze([Object.freeze({ minute: 1, count: 2 })]) });
    expect(parse(input).success).toBe(true);
  });
});

describe("computeHypeBase", () => {
  const A = cfg(100, [[5, 180], [30, 260]]); // points: (0 s, 100), (300 s, 180), (1800 s, 260)
  const at = (config: HypeConfig, seconds: number) => computeHypeBase(config, seconds);

  it.each([
    ["0 seconds is the base", 0, 100],
    ["a negative time counts as 0", -1, 100],
    ["a very negative time counts as 0", -100000, 100],
    ["half way to the first node: 100 + 80 * 150 / 300", 150, 140],
    ["60 seconds: 100 + 80 * 60 / 300", 60, 116],
    ["exactly the first node", 300, 180],
    ["half way between the nodes: 180 + 80 * 750 / 1500", 1050, 220],
    ["exactly the last node", 1800, 260],
    ["past the last node", 5000, 260],
    ["far past the last node", 1e9, 260],
    ["1 second: 100.27 rounds down", 1, 100],
    ["299 seconds: 179.73 rounds up", 299, 180],
    ["301 seconds: 180.05 rounds down", 301, 180],
    ["1799 seconds: 259.95 rounds up", 1799, 260],
  ])("%s", (_name, seconds, expected) => {
    expect(at(A, seconds)).toBe(expected);
  });

  it("is exactly the node count at each node's second", () => {
    const config = cfg(7, [[1, 10], [2, 500], [10, 3]]);
    expect(at(config, 60)).toBe(10);
    expect(at(config, 120)).toBe(500);
    expect(at(config, 600)).toBe(3);
  });

  it("interpolates a falling curve", () => {
    const falling = cfg(100, [[2, 40]]);
    expect(at(falling, 60)).toBe(70);
    expect(at(falling, 90)).toBe(55);
    expect(at(falling, 120)).toBe(40);
  });

  it("is the base at every time when there are no nodes", () => {
    for (const seconds of [-5, 0, 1, 59.5, 3600, 1e9]) expect(at(cfg(42, []), seconds)).toBe(42);
  });

  it("handles a single node at the largest allowed minute", () => {
    const late = cfg(0, [[1440, 86400]]);
    expect(at(late, 1)).toBe(1);
    expect(at(late, 86400)).toBe(86400);
    expect(at(late, 100000)).toBe(86400);
  });

  it.each([
    ["0.5 rounds up to 1", cfg(0, [[1, 60]]), 0.5, 1],
    ["1.49 rounds down to 1", cfg(0, [[1, 60]]), 1.49, 1],
    ["2.5 rounds up to 3", cfg(0, [[1, 60]]), 2.5, 3],
    ["a rising curve at x.5: 10 + 1 * 30 / 60 = 10.5 gives 11", cfg(10, [[1, 11]]), 30, 11],
    ["a falling curve at x.5: 11 - 1 * 30 / 60 = 10.5 gives 11", cfg(11, [[1, 10]]), 30, 11],
    ["1.5 gives 2", cfg(0, [[1, 3]]), 30, 2],
    ["2.5 on a falling curve gives 3", cfg(3, [[1, 0]]), 10, 3],
  ])("rounds half up: %s", (_name, config, seconds, expected) => {
    expect(at(config, seconds)).toBe(expected);
  });

  it.each([
    ["two nodes at the same minute", cfg(0, [[5, 1], [5, 2]])],
    ["decreasing minutes", cfg(0, [[10, 1], [5, 2]])],
    ["a node at minute 0", cfg(0, [[0, 5]])],
    ["a negative minute", cfg(0, [[-1, 5]])],
    ["a NaN minute", cfg(0, [[Number.NaN, 5]])],
    ["a NaN count", cfg(0, [[1, Number.NaN]])],
    ["a NaN base", cfg(Number.NaN, [[1, 5]])],
  ])("throws RangeError for %s", (_name, config) => {
    expect(() => at(config, 30)).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("throws RangeError for %s seconds", (seconds) => {
    expect(() => at(A, seconds)).toThrow(RangeError);
  });

  it("does not modify the configuration", () => {
    const frozen = Object.freeze({ ...A, nodes: Object.freeze(A.nodes.map((node) => Object.freeze({ ...node }))) });
    const snapshot = JSON.stringify(A);
    computeHypeBase(frozen, 500);
    expect(JSON.stringify(A)).toBe(snapshot);
  });
});

describe("seededRandom", () => {
  const slices = [0, 1, 2, 1000, 2147483647];
  // the algorithm is locked by these values (the 32-bit integer behind each result, value * 2^32)
  const SNAPSHOT: Record<string, number[]> = {
    a: [3658242584, 43458248, 670930765, 555271169, 2459853685],
    b: [3782323353, 1379483588, 379705854, 2820823140, 1614057327],
    [ID1]: [2209528110, 918554139, 2018040471, 902031386, 4128002583],
    [ID2]: [1609403628, 1798532702, 4053289095, 1581762746, 1632097066],
  };

  it.each(Object.entries(SNAPSHOT))("keeps its value for session %s", (id, expected) => {
    expect(slices.map((slice) => seededRandom(id, slice) * TWO_32)).toEqual(expected);
  });

  it("keeps its value for slices beyond 32 bits", () => {
    expect(seededRandom("a", 4294967296) * TWO_32).toBe(1462769191);
    expect(seededRandom("a", 4294967297) * TWO_32).toBe(2298178863);
    expect(seededRandom("a", Number.MAX_SAFE_INTEGER) * TWO_32).toBe(2465124994);
  });

  it("keeps the checksum over 2000 slices (the sum of value * 2^32)", () => {
    const checksum = (id: string) => Array.from({ length: 2000 }, (_, slice) => seededRandom(id, slice) * TWO_32).reduce((sum, value) => sum + value, 0);
    expect(checksum(ID1)).toBe(4336793387149);
    expect(checksum("a")).toBe(4353127481017);
  });

  it("gives the same result for the same input", () => {
    for (const id of ["a", ID1]) for (const slice of [0, 5, 99999]) expect(seededRandom(id, slice)).toBe(seededRandom(id, slice));
  });

  it("returns a value in [0, 1)", () => {
    for (let slice = 0; slice < 3000; slice++) {
      const value = seededRandom(ID1, slice);
      expect(value >= 0 && value < 1).toBe(true);
    }
  });

  it("gives different sequences for different sessions", () => {
    let equal = 0;
    for (let slice = 0; slice < 2000; slice++) if (seededRandom(ID1, slice) === seededRandom(ID2, slice)) equal++;
    expect(equal).toBe(0);
  });

  it("changes from one slice to the next", () => {
    let equal = 0;
    for (let slice = 1; slice < 2000; slice++) if (seededRandom(ID1, slice) === seededRandom(ID1, slice - 1)) equal++;
    expect(equal).toBeLessThanOrEqual(2);
  });

  it.each(["a", "b", ID1, ID2])("looks uniform over 2000 slices for session %s", (id) => {
    const values = Array.from({ length: 2000 }, (_, slice) => seededRandom(id, slice));
    // the mean of 2000 uniform values has a standard deviation of 0.0065, so 0.03 is about 4.6 of them
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.03);
    // each tenth should hold about 200 values with a standard deviation of about 13, so at least 150 and at most 250
    const tenths = Array<number>(10).fill(0);
    for (const value of values) tenths[Math.floor(value * 10)]++;
    for (const [index, count] of tenths.entries()) {
      expect(count, `tenth ${index}`).toBeGreaterThanOrEqual(150);
      expect(count, `tenth ${index}`).toBeLessThanOrEqual(250);
    }
  });

  it.each([
    ["an empty session id", "", 0],
    ["a negative slice", "a", -1],
    ["a fractional slice", "a", 1.5],
    ["a NaN slice", "a", Number.NaN],
    ["an infinite slice", "a", Number.POSITIVE_INFINITY],
    ["a slice beyond the safe integers", "a", 2 ** 53],
    ["a slice that is not a number", "a", "1" as never],
  ])("throws RangeError for %s", (_name, id, slice) => {
    expect(() => seededRandom(id, slice)).toThrow(RangeError);
  });

  it("does not depend on the system clock", () => {
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = seededRandom(ID1, 123);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(seededRandom(ID1, 123)).toBe(first);
  });
});

describe("seededJitter", () => {
  // columns are jitterPercent 0, 5, 10, 100; locked values for session "a"
  const SNAPSHOT: [slice: number, curve: number, results: number[]][] = [
    [0, 0, [0, 0, 0, 0]],
    [0, 1, [1, 1, 1, 2]],
    [0, 100, [100, 104, 107, 170]],
    [0, 1000, [1000, 1035, 1070, 1704]],
    [7, 0, [0, 0, 0, 0]],
    [7, 1, [1, 1, 1, 1]],
    [7, 100, [100, 102, 104, 137]],
    [7, 1000, [1000, 1018, 1037, 1367]],
  ];

  it.each(SNAPSHOT)("keeps its values for slice %s and curve value %s", (slice, curve, expected) => {
    expect([0, 5, 10, 100].map((percent) => seededJitter("a", slice, curve, percent))).toEqual(expected);
  });

  it("is exactly Math.round(curveValue) when jitterPercent is 0", () => {
    for (const curve of [0, 0.5, 1, 1.4999, 2.5, 3.5, 99.99, 1000, 123456.5]) expect(seededJitter(ID1, 3, curve, 0)).toBe(Math.round(curve));
  });

  it("stays between the lowest and highest possible value, and never goes negative (seeded, repeatable)", () => {
    const random = mulberry32(20261031);
    const failures: string[] = [];
    let moved = 0;
    for (let i = 0; i < 4000; i++) {
      const curve = random() < 0.5 ? Math.floor(random() * 5000) : random() * 5000;
      const percent = random() < 0.5 ? Math.floor(random() * 101) : random() * 100;
      const id = random() < 0.5 ? ID1 : "a";
      const slice = Math.floor(random() * 100000);
      const value = seededJitter(id, slice, curve, percent);
      const low = Math.round(curve * (1 - percent / 100));
      const high = Math.round(curve * (1 + percent / 100));
      if (value < low || value > high || value < 0 || !Number.isInteger(value)) failures.push(`${curve} ${percent} ${id} ${slice} -> ${value}`);
      if (value !== Math.round(curve)) moved++;
    }
    expect(failures).toEqual([]);
    expect(moved).toBeGreaterThan(2000); // the jitter really does move the value
  });

  it.each([
    ["a NaN curve value", ID1, 0, Number.NaN, 10],
    ["an infinite curve value", ID1, 0, Number.POSITIVE_INFINITY, 10],
    ["a negative curve value", ID1, 0, -1, 10],
    ["a negative percent", ID1, 0, 100, -1],
    ["a percent above 100", ID1, 0, 100, 101],
    ["a NaN percent", ID1, 0, 100, Number.NaN],
    ["an infinite percent", ID1, 0, 100, Number.POSITIVE_INFINITY],
    ["an empty session id", "", 0, 100, 10],
    ["a negative slice", ID1, -1, 100, 10],
    ["a fractional slice", ID1, 0.5, 100, 10],
  ])("throws RangeError for %s", (_name, id, slice, curve, percent) => {
    expect(() => seededJitter(id, slice, curve, percent)).toThrow(RangeError);
  });
});

describe("computeHypeTarget", () => {
  const CFG = cfg(100, [[5, 180], [30, 260]], 10, 10);
  const target = (seconds: number, real = 0, id = ID1, config = CFG) => computeHypeTarget(config, id, seconds, real);

  // the curve is read at the START of the time slice: slice * 10 seconds
  it.each([
    ["-5 (slice 0, curve at 0 s)", -5, 100],
    ["0 (slice 0, curve at 0 s)", 0, 100],
    ["9.9 (slice 0, curve at 0 s)", 9.9, 100],
    ["10 (slice 1, curve at 10 s)", 10, 97],
    ["299 (slice 29, curve at 290 s)", 299, 179],
    ["300 (slice 30, curve at 300 s)", 300, 188],
    ["1799 (slice 179, curve at 1790 s)", 1799, 237],
    ["1800 (slice 180, curve at 1800 s)", 1800, 241],
    ["100000 (slice 10000, past the last node)", 100000, 281],
  ])("keeps its value at elapsed %s", (_name, seconds, virtual) => {
    expect(target(seconds, 0)).toBe(virtual);
    expect(target(seconds, 7)).toBe(virtual + 7);
  });

  it("keeps its values around a slice boundary", () => {
    expect(target(19.999)).toBe(97);
    expect(target(20)).toBe(104);
    expect(target(20.5)).toBe(104);
    expect(target(29.999)).toBe(104);
    expect(target(30)).toBe(116);
  });

  it("gives the same result everywhere inside one time slice, for every configuration", () => {
    for (const config of [CFG, cfg(100, [[5, 180], [30, 260]], 0, 10), cfg(500, [], 20, 10), cfg(0, [[1, 600]], 50, 10)]) {
      const first = target(10, 3, ID1, config);
      for (const seconds of [10, 10.001, 12.5, 15, 17.25, 19, 19.9, 19.999]) expect(target(seconds, 3, ID1, config), `${seconds}`).toBe(first);
    }
  });

  it("can change when a time slice boundary is crossed", () => {
    expect(target(19.999)).not.toBe(target(20));
    let changes = 0;
    const flat = cfg(1000, [], 10, 10);
    for (let slice = 1; slice < 200; slice++) if (target(slice * 10, 0, ID1, flat) !== target((slice - 1) * 10, 0, ID1, flat)) changes++;
    expect(changes).toBeGreaterThan(150);
  });

  it("adds realOnline exactly", () => {
    for (const real of [0, 1, 7, 1000]) expect(target(299, real)).toBe(target(299, 0) + real);
  });

  it("treats a negative time like 0", () => {
    expect(target(-100, 3)).toBe(target(0, 3));
  });

  it("gives different sessions different results while the jitter is on, and the same result when it is off", () => {
    const big = cfg(1000, [], 10, 10);
    let differ = 0;
    for (let slice = 0; slice < 200; slice++) if (target(slice * 10, 0, ID1, big) !== target(slice * 10, 0, ID2, big)) differ++;
    expect(differ).toBeGreaterThanOrEqual(190);
    const off = cfg(1000, [[3, 2000]], 0, 10);
    for (let slice = 0; slice < 200; slice++) expect(target(slice * 10, 0, ID1, off)).toBe(target(slice * 10, 0, ID2, off));
  });

  it.each([
    ["a negative realOnline", -1],
    ["a fractional realOnline", 1.5],
    ["a NaN realOnline", Number.NaN],
    ["an infinite realOnline", Number.POSITIVE_INFINITY],
    ["a realOnline that is not a number", "1" as never],
  ])("throws RangeError for %s", (_name, real) => {
    expect(() => target(10, real)).toThrow(RangeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("throws RangeError for %s seconds", (seconds) => {
    expect(() => target(seconds)).toThrow(RangeError);
  });

  it("throws RangeError for an empty session id", () => {
    expect(() => target(10, 0, "")).toThrow(RangeError);
  });

  it("does not modify the configuration", () => {
    const frozen = Object.freeze({ ...CFG, nodes: Object.freeze(CFG.nodes.map((node) => Object.freeze({ ...node }))) });
    const snapshot = JSON.stringify(CFG);
    computeHypeTarget(frozen, ID1, 500, 2);
    expect(JSON.stringify(CFG)).toBe(snapshot);
  });

  it("does not depend on the system clock", () => {
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = target(777, 4);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(target(777, 4)).toBe(first);
  });
});

function randomConfig(random: () => number): HypeConfig {
  const minutes = new Set<number>();
  for (let count = Math.floor(random() * 6); minutes.size < count; ) minutes.add(1 + Math.floor(random() * 60));
  return {
    base: Math.floor(random() * 2000),
    nodes: [...minutes].sort((a, b) => a - b).map((minute) => ({ minute, count: Math.floor(random() * 3000) })),
    jitterPercent: Math.floor(random() * 101),
    jitterIntervalSeconds: [1, 5, 10, 60, 300][Math.floor(random() * 5)],
  };
}

// which part of the curve a moment falls in
function region(config: HypeConfig, seconds: number): "none" | "before" | "on" | "between" | "after" {
  if (config.nodes.length === 0) return "none";
  const nodeSeconds = config.nodes.map((node) => node.minute * 60);
  if (seconds < nodeSeconds[0]) return "before";
  if (seconds > nodeSeconds[nodeSeconds.length - 1]) return "after";
  return nodeSeconds.includes(seconds) ? "on" : "between";
}

// deliberately naive reference: plain loops and one division per step
function referenceBase(config: HypeConfig, elapsed: number): number {
  const xs = [0, ...config.nodes.map((node) => node.minute * 60)];
  const ys = [config.base, ...config.nodes.map((node) => node.count)];
  const t = elapsed < 0 ? 0 : elapsed;
  if (t >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 0;
  while (t >= xs[i + 1]) i++;
  return Math.round(ys[i] + ((ys[i + 1] - ys[i]) * (t - xs[i])) / (xs[i + 1] - xs[i]));
}

describe("computeHypeBase: properties (seeded, repeatable)", () => {
  it("agrees with a naive reference and keeps its values between the neighbouring counts", () => {
    const random = mulberry32(20261101);
    const seen: Record<string, number> = { none: 0, before: 0, on: 0, between: 0, after: 0 };
    const failures: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const config = randomConfig(random);
      expect(hypeConfigSchemaAccepts(config)).toBe(true);
      const nodeSeconds = config.nodes.map((node) => node.minute * 60);
      const mode = random();
      let seconds: number;
      if (nodeSeconds.length > 0 && mode < 0.25) seconds = nodeSeconds[Math.floor(random() * nodeSeconds.length)];
      else if (nodeSeconds.length > 0 && mode < 0.5) seconds = random() * nodeSeconds[0];
      else if (nodeSeconds.length > 1 && mode < 0.75) {
        const k = Math.floor(random() * (nodeSeconds.length - 1));
        seconds = nodeSeconds[k] + random() * (nodeSeconds[k + 1] - nodeSeconds[k]);
      } else seconds = (nodeSeconds[nodeSeconds.length - 1] ?? 0) + random() * 5000;
      if (random() < 0.5) seconds = Math.floor(seconds * 10) / 10;
      const part = region(config, seconds);
      seen[part]++;
      const value = computeHypeBase(config, seconds);
      if (value !== referenceBase(config, seconds) || !Number.isInteger(value) || value < 0) failures.push(`${JSON.stringify(config)} @ ${seconds}`);
      if (part === "on" && value !== config.nodes.find((node) => node.minute * 60 === seconds)?.count) failures.push(`on a node: ${JSON.stringify(config)} @ ${seconds}`);
      if (part === "between") {
        const k = nodeSeconds.findIndex((s) => s > seconds);
        const a = config.nodes[k - 1].count;
        const b = config.nodes[k].count;
        if (value < Math.min(a, b) || value > Math.max(a, b)) failures.push(`between: ${JSON.stringify(config)} @ ${seconds}`);
      }
    }
    expect(failures).toEqual([]);
    for (const part of ["before", "on", "between", "after"]) expect(seen[part], part).toBeGreaterThan(100); // all four situations are really covered
  });
});

function hypeConfigSchemaAccepts(config: HypeConfig): boolean {
  return hypeConfigSchema.safeParse(config).success;
}

describe("computeHypeTarget: properties (seeded, repeatable)", () => {
  it("gives one result for every moment inside a time slice, equal to the result at the start of the slice", () => {
    const random = mulberry32(20261102);
    const ids = [ID1, ID2, "a", "b", "7f1c-session"];
    const seen: Record<string, number> = { none: 0, before: 0, on: 0, between: 0, after: 0 };
    const failures: string[] = [];
    for (let i = 0; i < 800; i++) {
      const config = randomConfig(random);
      const id = ids[Math.floor(random() * ids.length)];
      const real = Math.floor(random() * 51);
      const slice = Math.floor(random() * 400);
      const interval = config.jitterIntervalSeconds;
      const start = slice * interval;
      seen[region(config, start)]++;
      const atStart = computeHypeTarget(config, id, start, real);
      if (!Number.isInteger(atStart) || atStart < real) failures.push(`not a non-negative integer: ${atStart}`);
      const samples = [start, start + interval - 0.001];
      for (let k = 0; k < 58; k++) samples.push(start + Math.floor(random() * interval * 1000) / 1000);
      expect(new Set(samples).size).toBeGreaterThanOrEqual(50); // at least 50 different moments
      for (const seconds of samples) {
        if (Math.floor(seconds / interval) !== slice) failures.push(`sample left the slice: ${seconds}`);
        if (computeHypeTarget(config, id, seconds, real) !== atStart) failures.push(`${JSON.stringify(config)} ${id} slice ${slice} @ ${seconds}`);
      }
    }
    expect(failures).toEqual([]);
    for (const part of ["before", "between", "after"]) expect(seen[part], part).toBeGreaterThan(30); // slices start in front of, between and behind the nodes
  });
});
