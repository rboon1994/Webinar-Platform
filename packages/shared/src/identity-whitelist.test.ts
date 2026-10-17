import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectCurrentRun, type RunWindow } from "./current-run.js";
import { normalizeEmail } from "./email.js";
import { parseWhitelistInput, publicReason, resolveWhitelistAccess, type WhitelistMatch } from "./identity-whitelist.js";

// small seeded PRNG so the property tests are repeatable
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const T = Date.UTC(2026, 2, 10, 9, 0, 0);
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const FULL_WIDTH_AT = String.fromCharCode(0xff20);
const E164 = /^\+[1-9][0-9]{6,14}$/;

type Span = [start: number, end: number];
const run = (id: string, createdAt: number, spans: Span[]): RunWindow => ({
  id,
  createdAt: new Date(createdAt),
  sessions: spans.map(([start, end]) => ({ startsAt: new Date(start), endsAt: new Date(end) })),
});

// every test runs with the system clock set to a moment unrelated to the test data
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("1999-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("parseWhitelistInput: emails", () => {
  it.each([
    ["foo@bar.com", "foo@bar.com"],
    [" Foo@Bar.COM ", "foo@bar.com"],
    ["A.B+tag@Example.Co.UK", "a.b+tag@example.co.uk"],
    ["0160809580@x.com", "0160809580@x.com"], // looks like a phone number at the front, but has an @
  ])("%j is the email %j", (raw, email) => {
    expect(parseWhitelistInput(raw, "MY")).toEqual({ kind: "email", email });
  });

  it.each([
    ["a@", "an empty domain"],
    ["a@b", "a domain without a dot"],
    ["a b@c.com", "a space in the address"],
    ["@b.com", "an empty local part"],
    ["a@@b.com", "two @"],
    ["a@b..com", "two dots in a row"],
    ["0160809580@", "digits and a trailing @: not a phone number"],
    ["@0160809580", "a leading @ with digits: not a phone number"],
    ["0160809580@x", "digits, an @ and a domain without a dot"],
  ])("%j is invalid because of %s, and is never read as a phone number", (raw) => {
    expect(parseWhitelistInput(raw, "MY")).toEqual({ kind: "invalid" });
  });
});

describe("parseWhitelistInput: phone numbers", () => {
  it.each([
    ["0160809580", "MY", "+60160809580"],
    ["016-080 9580", "MY", "+60160809580"],
    ["+60 16-080 9580", "MY", "+60160809580"],
    ["60160809580", "MY", "+60160809580"], // review (country code typed twice) still gives the number
    ["0160809580号", "MY", "+60160809580"], // review (unexpected character)
    ["9123 4567", "SG", "+6591234567"],
    ["+65 9123 4567", "MY", "+6591234567"],
    ["13812345678", "CN", "+8613812345678"],
  ])("%j with default %s is the phone number %s", (raw, country, phone) => {
    expect(parseWhitelistInput(raw, country as "MY")).toEqual({ kind: "phone", phone });
  });

  it.each([
    ["0160809580 ext 5", "an extension marker"],
    ["012-345 6789 x123", "an extension marker"],
    ["", "an empty string"],
    ["   ", "only spaces"],
    ["abc", "letters"],
    ["123", "a number that is too short"],
    ["0123456789/0198765432", "two numbers"],
  ])("%j is invalid because of %s", (raw) => {
    expect(parseWhitelistInput(raw, "MY")).toEqual({ kind: "invalid" });
  });

  it("does not count a full-width at sign as an @", () => {
    // with letters the phone path says invalid
    expect(parseWhitelistInput(`foo${FULL_WIDTH_AT}bar.com`, "MY")).toEqual({ kind: "invalid" });
    // without letters it is read as a phone number with an unexpected character (a review number)
    expect(parseWhitelistInput(`0160809580${FULL_WIDTH_AT}`, "MY")).toEqual({ kind: "phone", phone: "+60160809580" });
  });
});

describe("parseWhitelistInput: properties (seeded, repeatable)", () => {
  it("never reads input with an @ as a phone number, and only returns normalized values", () => {
    const random = mulberry32(20261201);
    const pieces = ["a", "B", "z", "0", "1", "6", "9", "@", "@", ".", ".", "-", " ", "+", "x", "com", "ab", "5", "8", "(", ")", FULL_WIDTH_AT];
    const seen = { email: 0, phone: 0, invalid: 0, withAt: 0 };
    const failures: string[] = [];
    for (let i = 0; i < 4000; i++) {
      let raw = "";
      const kind = i % 4;
      if (kind === 0) raw = `${random() < 0.5 ? "Foo" : "a.b"}${Math.floor(random() * 100)}@${random() < 0.5 ? "Example.com" : "x.co"}`; // email shaped
      else if (kind === 1) raw = `${["", "0", "+60 ", "60"][Math.floor(random() * 4)]}1${Math.floor(random() * 1e8)}`; // phone shaped
      else for (let j = 0, length = 1 + Math.floor(random() * 14); j < length; j++) raw += pieces[Math.floor(random() * pieces.length)]; // noise
      const result = parseWhitelistInput(raw, "MY");
      seen[result.kind]++;
      if (raw.includes("@")) {
        seen.withAt++;
        if (result.kind === "phone") failures.push(`phone from input with @: ${JSON.stringify(raw)}`);
      }
      if (result.kind === "email" && result.email !== normalizeEmail(raw)) failures.push(`email: ${JSON.stringify(raw)}`);
      if (result.kind === "phone" && !E164.test(result.phone)) failures.push(`phone: ${JSON.stringify(raw)}`);
    }
    expect(failures).toEqual([]);
    expect(seen.email).toBeGreaterThan(100);
    expect(seen.phone).toBeGreaterThan(100);
    expect(seen.invalid).toBeGreaterThan(100);
    expect(seen.withAt).toBeGreaterThan(100);
  });
});

describe("resolveWhitelistAccess", () => {
  const active = (enrolledRuns: RunWindow[], id = "p1"): WhitelistMatch => ({ id, status: "ACTIVE", enrolledRuns });
  const kicked = (enrolledRuns: RunWindow[], id = "p1"): WhitelistMatch => ({ id, status: "KICKED", enrolledRuns });
  const access = (match: WhitelistMatch, now: number) => resolveWhitelistAccess(match, new Date(now));
  const live = run("live", T, [[T - MIN, T + H]]);
  const soon = run("soon", T, [[T + H, T + 2 * H]]);
  const over = run("over", T, [[T - 2 * H, T - H]]);

  it("denies NOT_FOUND when there is no match", () => {
    expect(access(null, T)).toEqual({ kind: "denied", reason: "NOT_FOUND" });
  });

  it("denies KICKED for a kicked person, with or without enrolled runs", () => {
    expect(access(kicked([live]), T)).toEqual({ kind: "denied", reason: "KICKED" });
    expect(access(kicked([]), T)).toEqual({ kind: "denied", reason: "KICKED" });
    expect(access(kicked([run("empty", T, [])]), T)).toEqual({ kind: "denied", reason: "KICKED" });
  });

  it("denies NOT_ENROLLED for an active person with no runs", () => {
    expect(access(active([]), T)).toEqual({ kind: "denied", reason: "NOT_ENROLLED" });
  });

  it("denies NOT_ENROLLED when none of the enrolled runs has a session", () => {
    expect(access(active([run("a", T, []), run("b", T, [])]), T)).toEqual({ kind: "denied", reason: "NOT_ENROLLED" });
  });

  it("allows a person enrolled in a live run", () => {
    expect(access(active([live], "p7"), T)).toEqual({ kind: "allowed", attendeeId: "p7", runId: "live", phase: "live" });
  });

  it("allows a person who is only enrolled in a run that has not started", () => {
    expect(access(active([soon]), T)).toEqual({ kind: "allowed", attendeeId: "p1", runId: "soon", phase: "upcoming" });
  });

  it("allows a person whose run has ended, with the phase ended", () => {
    expect(access(active([over]), T)).toEqual({ kind: "allowed", attendeeId: "p1", runId: "over", phase: "ended" });
  });

  it("chooses among several enrolled runs like selectCurrentRun does", () => {
    expect(access(active([soon, over, live]), T)).toMatchObject({ runId: "live", phase: "live" });
    expect(access(active([over, run("later", T, [[T + 5 * H, T + 6 * H]]), soon]), T)).toMatchObject({ runId: "soon", phase: "upcoming" });
    expect(access(active([run("old", T, [[T - 9 * D, T - 9 * D + H]]), over]), T)).toMatchObject({ runId: "over", phase: "ended" });
    const newer = run("newer", T, [[T - MIN, T + H]]);
    const older = run("older", T - D, [[T - MIN, T + H]]);
    expect(access(active([newer, older]), T)).toMatchObject({ runId: "older" });
  });

  it.each([
    ["1 ms before the start", T - 1, "upcoming"],
    ["exactly at the start", T, "live"],
    ["1 ms before the end", T + H - 1, "live"],
    ["exactly at the end", T + H, "ended"],
  ])("%s is %s", (_name, now, phase) => {
    expect(access(active([run("r", T, [[T, T + H]])]), now)).toMatchObject({ kind: "allowed", runId: "r", phase });
  });

  it("throws RangeError for an invalid now or an invalid session (an enrolled person) and does not swallow it", () => {
    expect(() => resolveWhitelistAccess(active([live]), new Date(Number.NaN))).toThrow(RangeError);
    expect(() => access(active([run("bad", T, [[T, T]])]), T)).toThrow(RangeError);
    expect(() => access(active([{ id: "x", createdAt: new Date(Number.NaN), sessions: [] }]), T)).toThrow(RangeError);
  });

  it("throws RangeError for an invalid now whatever the match is: nobody found, kicked, or active", () => {
    const invalid = new Date(Number.NaN);
    expect(() => resolveWhitelistAccess(null, invalid)).toThrow(RangeError);
    expect(() => resolveWhitelistAccess(kicked([live]), invalid)).toThrow(RangeError);
    expect(() => resolveWhitelistAccess(kicked([]), invalid)).toThrow(RangeError);
    expect(() => resolveWhitelistAccess(active([live]), invalid)).toThrow(RangeError);
  });

  it("throws RangeError when now is not a Date, whatever the match is", () => {
    for (const match of [null, kicked([live]), active([live])]) {
      expect(() => resolveWhitelistAccess(match, T as never)).toThrow(RangeError);
      expect(() => resolveWhitelistAccess(match, "2026-03-10" as never)).toThrow(RangeError);
    }
  });

  it("works with frozen input and does not modify it", () => {
    const match = deepFreeze(active([run("b", T, [[T + D, T + D + H]]), run("a", T, [[T - D, T - D + H]])]));
    const snapshot = JSON.stringify(match);
    expect(access(match, T)).toMatchObject({ kind: "allowed", runId: "b", phase: "upcoming" });
    expect(JSON.stringify(match)).toBe(snapshot);
  });

  it("does not depend on the system clock", () => {
    const match = active([live]);
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = access(match, T);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(access(match, T)).toEqual(first);
  });
});

describe("publicReason", () => {
  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["NOT_ENROLLED", "NOT_FOUND"],
    ["KICKED", "REVOKED"],
    ["NO_RUN", "NO_RUN"],
  ] as const)("maps %s to %s", (reason, expected) => {
    expect(publicReason(reason)).toBe(expected);
  });

  it("gives NOT_FOUND and NOT_ENROLLED exactly the same public code", () => {
    expect(publicReason("NOT_ENROLLED")).toBe(publicReason("NOT_FOUND"));
  });

  it("only accepts the known reasons, and fails loudly for anything else at run time", () => {
    // @ts-expect-error an unknown reason is a type error
    expect(() => publicReason("SOMETHING_ELSE")).toThrow(RangeError);
  });
});

describe("resolveWhitelistAccess: properties (seeded, repeatable)", () => {
  it("agrees with the rules for 4000 random matches", () => {
    const random = mulberry32(20261202);
    const seen: Record<string, number> = { NOT_FOUND: 0, KICKED: 0, NOT_ENROLLED: 0, live: 0, upcoming: 0, ended: 0 };
    const failures: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const runs: RunWindow[] = [];
      for (let j = 0, count = Math.floor(random() * 4); j < count; j++) {
        const spans: Span[] = [];
        for (let k = 0, sessions = Math.floor(random() * 3); k < sessions; k++) {
          const start = T + Math.floor(random() * 16) * MIN;
          spans.push([start, start + (1 + Math.floor(random() * 4)) * MIN]);
        }
        runs.push(run(`r${j}`, T - Math.floor(random() * 3) * H, spans));
      }
      const mode = random();
      const match: WhitelistMatch = mode < 0.2 ? null : { id: "p1", status: mode < 0.4 ? "KICKED" : "ACTIVE", enrolledRuns: runs };
      const tick = T + Math.floor(random() * 22) * MIN;
      const nowMs = random() < 0.7 ? tick : tick + Math.floor(random() * 5) - 2;
      const actual = resolveWhitelistAccess(match, new Date(nowMs));
      const current = match && match.status === "ACTIVE" ? selectCurrentRun(runs, new Date(nowMs)) : null;
      const expected = match === null
        ? { kind: "denied", reason: "NOT_FOUND" }
        : match.status === "KICKED"
          ? { kind: "denied", reason: "KICKED" }
          : current
            ? { kind: "allowed", attendeeId: "p1", runId: current.runId, phase: current.phase }
            : { kind: "denied", reason: "NOT_ENROLLED" };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${JSON.stringify(match)} @ ${nowMs}`);
      seen[actual.kind === "allowed" ? actual.phase : actual.reason]++;
    }
    expect(failures).toEqual([]);
    for (const outcome of Object.keys(seen)) expect(seen[outcome], outcome).toBeGreaterThan(100); // the test is not spinning on one outcome
  });
});
