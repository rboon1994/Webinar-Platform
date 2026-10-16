import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectCurrentRun, selectEnrollableRun, type RunWindow } from "./current-run.js";
import { getWebinarState } from "./webinar-state.js";

// small seeded PRNG so the property test is repeatable
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T = Date.UTC(2026, 2, 10, 9, 0, 0);
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

type Span = [start: number, end: number];
const run = (id: string, createdAt: number, spans: Span[]): RunWindow => ({
  id,
  createdAt: new Date(createdAt),
  sessions: spans.map(([start, end]) => ({ startsAt: new Date(start), endsAt: new Date(end) })),
});
const current = (runs: RunWindow[], now: number) => selectCurrentRun(runs, new Date(now));
const enrollable = (runs: RunWindow[], now: number) => selectEnrollableRun(runs, new Date(now));

// every test runs with the system clock set to a moment unrelated to the test data
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("1999-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("selectCurrentRun: the three steps", () => {
  it("1: a run with a live session wins over one that is only upcoming", () => {
    const soon = run("soon", T, [[T + MIN, T + 2 * MIN]]);
    const live = run("live", T + D, [[T - MIN, T + H]]);
    expect(current([soon, live], T)).toEqual({ runId: "live", phase: "live" });
    expect(current([live, soon], T)).toEqual({ runId: "live", phase: "live" });
  });

  it("1: a live run wins over an ended one", () => {
    const old = run("old", T - D, [[T - 2 * D, T - D]]);
    const live = run("live", T, [[T - MIN, T + H]]);
    expect(current([old, live], T)).toEqual({ runId: "live", phase: "live" });
  });

  it("2: with nothing live, the run whose earliest future session starts first wins", () => {
    const later = run("later", T, [[T + 2 * H, T + 3 * H]]);
    const sooner = run("sooner", T + D, [[T + H, T + 2 * H]]);
    expect(current([later, sooner], T)).toEqual({ runId: "sooner", phase: "upcoming" });
  });

  it("2: looks at the earliest FUTURE session of each run, not at its first session", () => {
    const pastAndFuture = run("a", T, [[T - 3 * D, T - 3 * D + H], [T + 5 * D, T + 5 * D + H]]);
    const justFuture = run("b", T, [[T + D, T + D + H]]);
    expect(current([pastAndFuture, justFuture], T)).toEqual({ runId: "b", phase: "upcoming" });
  });

  it("3: when everything is over, the run whose last session ended latest wins, and it is not enrollable", () => {
    const early = run("early", T, [[T - 5 * D, T - 5 * D + H]]);
    const recent = run("recent", T + D, [[T - 2 * D, T - 2 * D + H]]);
    expect(current([early, recent], T)).toEqual({ runId: "recent", phase: "ended" });
    expect(enrollable([early, recent], T)).toBeNull();
  });

  it("3: uses the latest endsAt of any session, not the last one in the list", () => {
    const a = run("a", T, [[T - 2 * D, T - D], [T - 5 * D, T - 4 * D]]);
    const b = run("b", T, [[T - 3 * D, T - 2 * D]]);
    expect(current([b, a], T)).toEqual({ runId: "a", phase: "ended" });
  });

  it("a run with both ended and not-yet-started sessions counts as upcoming", () => {
    const mixed = run("mixed", T, [[T - 2 * D, T - D], [T + D, T + D + H]]);
    const onlyEnded = run("ended", T, [[T - D, T - D + H]]);
    expect(current([onlyEnded, mixed], T)).toEqual({ runId: "mixed", phase: "upcoming" });
    expect(enrollable([mixed], T)).toBe("mixed");
  });

  it("ignores runs that have no sessions", () => {
    const empty = run("empty", T - D, []);
    const real = run("real", T, [[T + D, T + D + H]]);
    expect(current([empty, real], T)).toEqual({ runId: "real", phase: "upcoming" });
    expect(current([empty], T)).toBeNull();
    expect(current([empty, run("empty2", T, [])], T)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(current([], T)).toBeNull();
    expect(enrollable([], T)).toBeNull();
  });
});

describe("selectCurrentRun: ties", () => {
  it("live: the earliest createdAt wins", () => {
    const newer = run("newer", T, [[T - MIN, T + H]]);
    const older = run("older", T - D, [[T - MIN, T + H]]);
    expect(current([newer, older], T)).toEqual({ runId: "older", phase: "live" });
  });

  it("upcoming: equal start times fall back to the earliest createdAt", () => {
    const newer = run("newer", T, [[T + D, T + D + H]]);
    const older = run("older", T - D, [[T + D, T + 2 * D]]);
    expect(current([newer, older], T)).toEqual({ runId: "older", phase: "upcoming" });
  });

  it("ended: equal last end times fall back to the earliest createdAt", () => {
    const newer = run("newer", T, [[T - 2 * H, T - H]]);
    const older = run("older", T - D, [[T - 3 * H, T - H]]);
    expect(current([newer, older], T)).toEqual({ runId: "older", phase: "ended" });
  });

  it("equal createdAt falls back to the smaller id", () => {
    const b = run("b", T, [[T - MIN, T + H]]);
    const a = run("a", T, [[T - MIN, T + H]]);
    expect(current([b, a], T)).toEqual({ runId: "a", phase: "live" });
    expect(current([a, b], T)).toEqual({ runId: "a", phase: "live" });
  });

  it.each([
    ["a", "B", "B"],
    ["10", "9", "10"],
    ["r9", "r10", "r10"],
  ])("compares the ids %j and %j like a < b (the smaller is %j)", (x, y, smaller) => {
    expect([x, y].sort()[0]).toBe(smaller);
    expect(current([run(x, T, [[T, T + H]]), run(y, T, [[T, T + H]])], T)).toEqual({ runId: smaller, phase: "live" });
  });
});

describe("selectCurrentRun: boundaries match getWebinarState", () => {
  const only = run("only", T, [[T, T + H]]);

  it.each([
    ["1 ms before the start", "upcoming", T - 1],
    ["exactly at the start", "live", T],
    ["1 ms before the end", "live", T + H - 1],
    ["exactly at the end", "ended", T + H],
  ])("%s is %s", (_name, phase, now) => {
    expect(current([only], now)).toEqual({ runId: "only", phase });
  });

  it("back-to-back sessions: the next one is live at the instant the previous one ends", () => {
    const backToBack = run("b2b", T, [[T, T + H], [T + H, T + 2 * H]]);
    expect(current([backToBack], T + H)).toEqual({ runId: "b2b", phase: "live" });
    expect(current([backToBack], T + 2 * H)).toEqual({ runId: "b2b", phase: "ended" });
  });

  it("gives the phase getWebinarState gives for the same single session, at every interesting moment", () => {
    const stateToPhase = { live: "live", upcoming: "upcoming", ended: "ended" } as const;
    const sessions = [{ id: "x", startsAt: new Date(T), endsAt: new Date(T + H) }];
    for (const now of [T - D, T - 1, T, T + 1, T + H - 1, T + H, T + H + 1, T + D]) {
      const webinar = getWebinarState(sessions, new Date(now));
      if (webinar.state === "no_schedule") throw new Error("unexpected");
      expect(current([only], now)?.phase, `now = ${now - T}`).toBe(stateToPhase[webinar.state]);
    }
  });
});

describe("selectEnrollableRun", () => {
  it("returns the id for a live run", () => {
    expect(enrollable([run("r", T, [[T - MIN, T + H]])], T)).toBe("r");
  });

  it("returns the id for an upcoming run", () => {
    expect(enrollable([run("r", T, [[T + MIN, T + H]])], T)).toBe("r");
  });

  it("returns null when the best run has ended", () => {
    expect(enrollable([run("r", T, [[T - 2 * H, T - H]])], T)).toBeNull();
  });

  it("returns null when there is no current run", () => {
    expect(enrollable([], T)).toBeNull();
    expect(enrollable([run("empty", T, [])], T)).toBeNull();
  });

  it("does not skip past a recently ended run to an older upcoming one: the upcoming run is the current one", () => {
    const ended = run("ended", T, [[T - 2 * H, T - H]]);
    const upcoming = run("upcoming", T - 10 * D, [[T + 30 * D, T + 30 * D + H]]);
    expect(enrollable([ended, upcoming], T)).toBe("upcoming");
  });
});

describe("selectCurrentRun: invalid input", () => {
  const good = run("good", T, [[T, T + H]]);
  const invalid = new Date(Number.NaN);

  it("throws RangeError for an invalid now", () => {
    expect(() => selectCurrentRun([good], invalid)).toThrow(RangeError);
    expect(() => selectCurrentRun([], invalid)).toThrow(RangeError);
    expect(() => selectEnrollableRun([good], invalid)).toThrow(RangeError);
  });

  it("throws RangeError for an invalid createdAt, also on a run without sessions", () => {
    expect(() => selectCurrentRun([{ id: "x", createdAt: invalid, sessions: [] }], new Date(T))).toThrow(RangeError);
    expect(() => selectCurrentRun([{ id: "x", createdAt: invalid, sessions: good.sessions }], new Date(T))).toThrow(RangeError);
  });

  it("throws RangeError for an invalid date or a non-positive length in a session", () => {
    const bad = (startsAt: Date, endsAt: Date) => [{ id: "x", createdAt: new Date(T), sessions: [{ startsAt, endsAt }] }];
    expect(() => selectCurrentRun(bad(invalid, new Date(T)), new Date(T))).toThrow(RangeError);
    expect(() => selectCurrentRun(bad(new Date(T), invalid), new Date(T))).toThrow(RangeError);
    expect(() => selectCurrentRun(bad(new Date(T), new Date(T)), new Date(T))).toThrow(RangeError);
    expect(() => selectCurrentRun(bad(new Date(T + H), new Date(T)), new Date(T))).toThrow(RangeError);
    expect(() => selectEnrollableRun(bad(new Date(T), new Date(T)), new Date(T))).toThrow(RangeError);
  });

  it("checks every run, also one that would not change the result", () => {
    expect(() => current([good, run("far", T, [[T + 9 * D, T + 9 * D]])], T)).toThrow(RangeError);
  });

  it("throws RangeError for something that is not a Date", () => {
    expect(() => selectCurrentRun([good], T as never)).toThrow(RangeError);
  });
});

describe("selectCurrentRun: purity", () => {
  it("does not modify the arrays, the runs or the dates it is given", () => {
    const runs = [run("b", T + H, [[T + D, T + D + H], [T - D, T - D + H]]), run("a", T, [[T - 2 * D, T - D]])];
    const now = new Date(T);
    const snapshot = JSON.stringify([runs, now]);
    const frozen = Object.freeze(runs.map((r) => Object.freeze({ ...r, sessions: Object.freeze([...r.sessions]) })));
    selectCurrentRun(frozen, now);
    selectEnrollableRun(frozen, now);
    expect(JSON.stringify([runs, now])).toBe(snapshot);
    expect(runs.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("does not depend on the system clock", () => {
    const runs = [run("a", T, [[T - D, T - D + H], [T + D, T + D + H]])];
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = current(runs, T);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(current(runs, T)).toEqual(first);
  });
});

// deliberately naive reference: the rules written as plain filters and loops
function reference(runs: RunWindow[], now: Date) {
  const t = now.getTime();
  const oldest = (list: RunWindow[]) => {
    let best: RunWindow | undefined;
    for (const r of list) {
      const better = !best || r.createdAt.getTime() < best.createdAt.getTime() || (r.createdAt.getTime() === best.createdAt.getTime() && r.id < best.id);
      if (better) best = r;
    }
    return best!;
  };
  const live = runs.filter((r) => r.sessions.some((s) => s.startsAt.getTime() <= t && t < s.endsAt.getTime()));
  if (live.length > 0) return { runId: oldest(live).id, phase: "live" as const };
  const upcoming = runs.filter((r) => r.sessions.some((s) => s.startsAt.getTime() > t));
  if (upcoming.length > 0) {
    const nextStart = (r: RunWindow) => Math.min(...r.sessions.filter((s) => s.startsAt.getTime() > t).map((s) => s.startsAt.getTime()));
    const earliest = Math.min(...upcoming.map(nextStart));
    return { runId: oldest(upcoming.filter((r) => nextStart(r) === earliest)).id, phase: "upcoming" as const };
  }
  const withSessions = runs.filter((r) => r.sessions.length > 0);
  if (withSessions.length > 0) {
    const lastEnd = (r: RunWindow) => Math.max(...r.sessions.map((s) => s.endsAt.getTime()));
    const latest = Math.max(...withSessions.map(lastEnd));
    return { runId: oldest(withSessions.filter((r) => lastEnd(r) === latest)).id, phase: "ended" as const };
  }
  return null;
}

describe("selectCurrentRun and selectEnrollableRun: agree with a naive reference (seeded, repeatable)", () => {
  it("gives the same answer for 4000 random sets of runs and moments", () => {
    const random = mulberry32(20261021);
    const pool = ["r1", "r2", "R3", "r10", "r9"];
    const counts: Record<string, number> = { live: 0, upcoming: 0, ended: 0, none: 0 };
    const failures: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const ids = [...pool].sort(() => random() - 0.5);
      const runs: RunWindow[] = [];
      for (let j = 0, count = Math.floor(random() * 5); j < count; j++) {
        const spans: Span[] = [];
        for (let k = 0, sessions = Math.floor(random() * 4); k < sessions; k++) {
          const start = T + Math.floor(random() * 16) * MIN; // a coarse grid, so equal times are common
          spans.push([start, start + (1 + Math.floor(random() * 4)) * MIN]);
        }
        runs.push(run(ids[j], T - Math.floor(random() * 3) * H, spans));
      }
      const tick = T + Math.floor(random() * 22) * MIN;
      const mode = random();
      const nowMs = mode < 0.6 ? tick : mode < 0.7 ? tick - 1 : mode < 0.8 ? tick + 1 : T + Math.floor(random() * 22 * MIN);
      const now = new Date(nowMs);
      const expected = reference(runs, now);
      const actual = selectCurrentRun(runs, now);
      const expectedEnrollable = expected && expected.phase !== "ended" ? expected.runId : null;
      counts[expected ? expected.phase : "none"]++;
      if (JSON.stringify(actual) !== JSON.stringify(expected) || selectEnrollableRun(runs, now) !== expectedEnrollable) failures.push(`${JSON.stringify(runs)} @ ${nowMs}`);
    }
    expect(failures).toEqual([]);
    for (const outcome of Object.keys(counts)) expect(counts[outcome], outcome).toBeGreaterThan(100); // the test is not spinning on one outcome
  });
});
