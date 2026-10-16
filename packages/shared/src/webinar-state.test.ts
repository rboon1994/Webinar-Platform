import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWebinarState, type SessionWindow, type WebinarState } from "./webinar-state.js";

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

const session = (id: string, start: number, end: number): SessionWindow => ({ id, startsAt: new Date(start), endsAt: new Date(end) });
const state = (sessions: SessionWindow[], now: number) => getWebinarState(sessions, new Date(now));

// every test runs with the system clock set to a moment unrelated to the test data
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("1999-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getWebinarState: one session", () => {
  const only = session("s1", T, T + H);

  it.each([
    ["1 ms before the start", "upcoming", T - 1],
    ["exactly at the start", "live", T],
    ["in the middle", "live", T + 30 * MIN],
    ["1 ms before the end", "live", T + H - 1],
    ["exactly at the end", "ended", T + H],
    ["after the end", "ended", T + D],
  ])("%s is %s", (_name, expected, now) => {
    expect(state([only], now).state).toBe(expected);
  });

  it("returns the session in each state", () => {
    expect(state([only], T - 1)).toEqual({ state: "upcoming", phase: "before_first", next: only });
    expect(state([only], T)).toEqual({ state: "live", session: only });
    expect(state([only], T + H)).toEqual({ state: "ended", lastEnded: only });
  });

  it("returns no_schedule for an empty list", () => {
    expect(state([], T)).toEqual({ state: "no_schedule" });
  });
});

describe("getWebinarState: several sessions", () => {
  const day1 = session("d1", T, T + H);
  const day2 = session("d2", T + D, T + D + H);

  it("is before_first until the first session starts", () => {
    expect(state([day1, day2], T - 1)).toEqual({ state: "upcoming", phase: "before_first", next: day1 });
  });

  it("is between_days in the gap after a session ended, with the next session as next", () => {
    expect(state([day1, day2], T + H)).toEqual({ state: "upcoming", phase: "between_days", next: day2 });
    expect(state([day1, day2], T + D - 1)).toEqual({ state: "upcoming", phase: "between_days", next: day2 });
  });

  it("is live again when the next session starts", () => {
    expect(state([day1, day2], T + D)).toEqual({ state: "live", session: day2 });
  });

  it("is ended once every session is over and reports the last one", () => {
    expect(state([day1, day2], T + D + H)).toEqual({ state: "ended", lastEnded: day2 });
  });

  it("makes the next session live at the instant the previous one ends (back to back)", () => {
    const a = session("a", T, T + H);
    const b = session("b", T + H, T + 2 * H);
    expect(state([a, b], T + H - 1)).toEqual({ state: "live", session: a });
    expect(state([a, b], T + H)).toEqual({ state: "live", session: b });
    expect(state([a, b], T + 2 * H)).toEqual({ state: "ended", lastEnded: b });
  });

  it("does not care about the order of the input", () => {
    const d3 = session("d3", T + 2 * D, T + 2 * D + H);
    for (const order of [[day1, day2, d3], [d3, day2, day1], [day2, d3, day1]]) {
      expect(state(order, T + D + 2 * H)).toEqual({ state: "upcoming", phase: "between_days", next: d3 });
      expect(state(order, T + 2 * D)).toEqual({ state: "live", session: d3 });
      expect(state(order, T + 3 * D)).toEqual({ state: "ended", lastEnded: d3 });
    }
  });

  it("picks the session that ended last as lastEnded, whatever the input order", () => {
    const long = session("long", T, T + 5 * H);
    const short = session("short", T + H, T + 2 * H);
    expect(state([short, long], T + 6 * H)).toEqual({ state: "ended", lastEnded: long });
    expect(state([long, short], T + 6 * H)).toEqual({ state: "ended", lastEnded: long });
  });
});

describe("getWebinarState: ties", () => {
  it("picks the smaller id when two live sessions start at the same moment", () => {
    const b = session("b", T, T + H);
    const a = session("a", T, T + 2 * H);
    expect(state([b, a], T + MIN)).toEqual({ state: "live", session: a });
    expect(state([a, b], T + MIN)).toEqual({ state: "live", session: a });
  });

  it("picks the session that started first when live sessions overlap, even with a larger id", () => {
    const early = session("z", T, T + 2 * H);
    const late = session("a", T + H, T + 3 * H);
    expect(state([late, early], T + H + 30 * MIN)).toEqual({ state: "live", session: early });
  });

  it("picks the smaller id for upcoming sessions that start at the same moment", () => {
    const b = session("b", T + D, T + D + H);
    const a = session("a", T + D, T + D + 2 * H);
    expect(state([b, a], T)).toEqual({ state: "upcoming", phase: "before_first", next: a });
  });

  it("picks the smaller id for ended sessions that ended at the same moment", () => {
    const b = session("b", T, T + H);
    const a = session("a", T + 30 * MIN, T + H);
    expect(state([b, a], T + 2 * H)).toEqual({ state: "ended", lastEnded: a });
  });

  it.each([
    ["a", "B", "B"],
    ["B", "a", "B"],
    ["10", "9", "10"],
    ["9", "10", "10"],
    ["a", "ab", "a"],
    ["", "a", ""],
  ])("compares the ids %j and %j like a < b (the smaller is %j)", (x, y, smaller) => {
    expect([x, y].sort()[0]).toBe(smaller); // the same ordering JavaScript's < uses
    expect(state([session(x, T, T + H), session(y, T, T + H)], T)).toMatchObject({ state: "live", session: { id: smaller } });
  });

  it("compares ids by UTF-16 code unit, not by code point and not by locale", () => {
    const astral = String.fromCodePoint(0x1f600); // two code units, the first is 0xD83D
    const fullWidth = String.fromCharCode(0xff5e);
    expect(astral < fullWidth).toBe(true);
    expect(state([session(fullWidth, T, T + H), session(astral, T, T + H)], T)).toMatchObject({ session: { id: astral } });
  });
});

describe("getWebinarState: invalid input", () => {
  const ok = session("ok", T, T + H);
  const invalid = new Date(Number.NaN);

  it("throws RangeError for an invalid now", () => {
    expect(() => getWebinarState([ok], invalid)).toThrow(RangeError);
    expect(() => getWebinarState([], invalid)).toThrow(RangeError);
  });

  it("throws RangeError for a session with an invalid startsAt or endsAt", () => {
    expect(() => getWebinarState([{ id: "x", startsAt: invalid, endsAt: new Date(T) }], new Date(T))).toThrow(RangeError);
    expect(() => getWebinarState([{ id: "x", startsAt: new Date(T), endsAt: invalid }], new Date(T))).toThrow(RangeError);
  });

  it("throws RangeError when endsAt is not after startsAt", () => {
    expect(() => state([session("x", T, T)], T)).toThrow(RangeError);
    expect(() => state([session("x", T + H, T)], T)).toThrow(RangeError);
  });

  it("checks every session, also one that would not change the result", () => {
    expect(() => state([ok, session("far", T + 10 * D, T + 10 * D)], T)).toThrow(RangeError);
  });

  it("throws RangeError for something that is not a Date", () => {
    expect(() => getWebinarState([ok], T as never)).toThrow(RangeError);
    expect(() => getWebinarState([{ id: "x", startsAt: "2026-03-10" as never, endsAt: new Date(T) }], new Date(T))).toThrow(RangeError);
  });
});

describe("getWebinarState: purity", () => {
  it("does not modify the array, the sessions or the dates it is given", () => {
    const sessions = [session("b", T + D, T + D + H), session("a", T, T + H)];
    const now = new Date(T + 2 * H);
    const snapshot = JSON.stringify([sessions, now]);
    const frozen = Object.freeze(sessions.map((s) => Object.freeze(s)));
    getWebinarState(frozen, now);
    expect(JSON.stringify([sessions, now])).toBe(snapshot);
    expect(sessions.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("does not depend on the system clock", () => {
    const sessions = [session("a", T, T + H), session("b", T + D, T + D + H)];
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = state(sessions, T + 2 * H);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(state(sessions, T + 2 * H)).toEqual(first);
  });
});

// deliberately naive reference: the rules written as plain loops
function reference(sessions: SessionWindow[], now: Date): WebinarState {
  const t = now.getTime();
  let live: SessionWindow | undefined;
  let next: SessionWindow | undefined;
  let lastEnded: SessionWindow | undefined;
  let anyEnded = false;
  for (const s of sessions) {
    const start = s.startsAt.getTime();
    const end = s.endsAt.getTime();
    if (start <= t && t < end && (!live || start < live.startsAt.getTime() || (start === live.startsAt.getTime() && s.id < live.id))) live = s;
    if (start > t && (!next || start < next.startsAt.getTime() || (start === next.startsAt.getTime() && s.id < next.id))) next = s;
    if (end <= t) {
      anyEnded = true;
      if (!lastEnded || end > lastEnded.endsAt.getTime() || (end === lastEnded.endsAt.getTime() && s.id < lastEnded.id)) lastEnded = s;
    }
  }
  if (live) return { state: "live", session: live };
  if (next) return { state: "upcoming", phase: anyEnded ? "between_days" : "before_first", next };
  if (lastEnded) return { state: "ended", lastEnded };
  return { state: "no_schedule" };
}

describe("getWebinarState: agrees with a naive reference (seeded, repeatable)", () => {
  it("gives the same answer for 4000 random schedules and moments", () => {
    const random = mulberry32(20261020);
    const pool = ["a", "b", "B", "10", "9", "c"];
    const counts: Record<string, number> = { live: 0, upcoming: 0, ended: 0, no_schedule: 0 };
    const failures: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const ids = [...pool].sort(() => random() - 0.5);
      const sessions: SessionWindow[] = [];
      for (let j = 0, count = Math.floor(random() * 6); j < count; j++) {
        const start = T + Math.floor(random() * 16) * MIN; // a coarse grid, so equal times are common
        sessions.push(session(ids[j], start, start + (1 + Math.floor(random() * 4)) * MIN));
      }
      const tick = T + Math.floor(random() * 22) * MIN;
      const mode = random();
      const nowMs = mode < 0.6 ? tick : mode < 0.7 ? tick - 1 : mode < 0.8 ? tick + 1 : T + Math.floor(random() * 22 * MIN);
      const now = new Date(nowMs);
      const expected = reference(sessions, now);
      const actual = getWebinarState(sessions, now);
      counts[expected.state]++;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${JSON.stringify(sessions)} @ ${nowMs}`);
    }
    expect(failures).toEqual([]);
    for (const outcome of Object.keys(counts)) expect(counts[outcome], outcome).toBeGreaterThan(100); // the test is not spinning on one outcome
  });
});
