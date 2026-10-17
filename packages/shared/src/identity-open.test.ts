import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveIdentity, type KnownPerson, type OpenLookup, type OpenResolution } from "./identity-open.js";

// small seeded PRNG so the property test is repeatable
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

const INPUT = { name: "Ann Lee", phone: "+60160809580", email: "ann@example.com" };
const OTHER_PHONE = "+60123456789";
const OTHER_EMAIL = "other@example.com";

const person = (id: string, overrides: Partial<KnownPerson> = {}): KnownPerson => ({ id, phone: null, email: null, status: "ACTIVE", enrolledRunIds: [], ...overrides });
// the person found by the e-mail (A) and by the phone number (B), as the caller would look them up
const foundByEmail = (id: string, overrides: Partial<KnownPerson> = {}) => person(id, { email: INPUT.email, ...overrides });
const foundByPhone = (id: string, overrides: Partial<KnownPerson> = {}) => person(id, { phone: INPUT.phone, ...overrides });
const resolve = (lookup: Partial<OpenLookup>, enrollable: string | null = "r1", input = INPUT) =>
  resolveIdentity(input, { byEmail: null, byPhone: null, ...lookup }, enrollable);

const enrollExisting = (attendeeId: string, runId = "r1") => ({ type: "enroll", runId, attendee: { kind: "existing", attendeeId } });

// every test runs with the system clock set to a moment unrelated to the test data
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("1999-01-01T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("resolveIdentity: kicked people are refused first", () => {
  const rejectedKicked = { kind: "rejected", reason: "KICKED" };

  it.each([
    ["A is kicked", { byEmail: foundByEmail("a", { status: "KICKED" }) }],
    ["B is kicked", { byPhone: foundByPhone("b", { status: "KICKED" }) }],
    ["both are kicked", { byEmail: foundByEmail("a", { status: "KICKED" }), byPhone: foundByPhone("b", { status: "KICKED" }) }],
    ["A is fine but B is kicked", { byEmail: foundByEmail("a"), byPhone: foundByPhone("b", { status: "KICKED" }) }],
    ["A is kicked but B is fine", { byEmail: foundByEmail("a", { status: "KICKED" }), byPhone: foundByPhone("b") }],
    ["the only match, found by phone, is kicked", { byPhone: foundByPhone("b", { status: "KICKED" }) }],
    ["the one person found twice is kicked", { byEmail: foundByEmail("p", { phone: INPUT.phone, status: "KICKED" }), byPhone: foundByPhone("p", { email: INPUT.email, status: "KICKED" }) }],
  ])("%s", (_name, lookup) => {
    expect(resolve(lookup)).toEqual(rejectedKicked);
  });

  it("answers KICKED, not NO_RUN, when a kicked person is found and there is no run to enrol in", () => {
    expect(resolve({ byEmail: foundByEmail("a", { status: "KICKED" }) }, null)).toEqual(rejectedKicked);
    expect(resolve({ byPhone: foundByPhone("b", { status: "KICKED" }) }, null)).toEqual(rejectedKicked);
  });

  it("still refuses a kicked person who is already enrolled in the run", () => {
    expect(resolve({ byEmail: foundByEmail("a", { status: "KICKED", enrolledRunIds: ["r1"] }) })).toEqual(rejectedKicked);
  });

  it("returns an object without any writes, at run time and in the type", () => {
    const result: OpenResolution = resolve({ byEmail: foundByEmail("a", { status: "KICKED" }) });
    expect(Object.keys(result)).toEqual(["kind", "reason"]);
    if (result.kind === "rejected") {
      // @ts-expect-error a rejected result has no writes
      void result.writes;
      expect("writes" in result).toBe(false);
    } else {
      throw new Error("expected a rejected result");
    }
  });
});

describe("resolveIdentity: no run to enrol in", () => {
  const rejectedNoRun = { kind: "rejected", reason: "NO_RUN" };

  it.each([
    ["a new person", {}],
    ["a person found by e-mail", { byEmail: foundByEmail("a", { enrolledRunIds: ["r9"] }) }],
    ["a person found by e-mail who lacks a phone (nothing may be filled in)", { byEmail: foundByEmail("a") }],
    ["a person found by phone who lacks an e-mail (nothing may be filled in)", { byPhone: foundByPhone("b") }],
    ["the same person found twice", { byEmail: foundByEmail("p", { phone: INPUT.phone }), byPhone: foundByPhone("p", { email: INPUT.email }) }],
    ["two different people", { byEmail: foundByEmail("a"), byPhone: foundByPhone("b") }],
  ])("%s is refused with NO_RUN and nothing is written", (_name, lookup) => {
    const result = resolve(lookup, null);
    expect(result).toEqual(rejectedNoRun);
    expect(Object.keys(result)).toEqual(["kind", "reason"]);
  });
});

describe("resolveIdentity: nobody found", () => {
  it("creates the person and enrols them", () => {
    expect(resolve({})).toEqual({
      kind: "proceed",
      attendee: { kind: "new" },
      runId: "r1",
      writes: [
        { type: "createAttendee", name: "Ann Lee", phone: INPUT.phone, email: INPUT.email, source: "SELF_REGISTERED" },
        { type: "enroll", runId: "r1", attendee: { kind: "new" } },
      ],
      warnings: [],
    });
  });

  it("uses the trimmed name", () => {
    const result = resolve({}, "r1", { ...INPUT, name: "  Ann Lee \t" });
    expect(result).toMatchObject({ writes: [{ type: "createAttendee", name: "Ann Lee" }, { type: "enroll" }] });
  });
});

describe("resolveIdentity: one person found", () => {
  it("A only, who already has a different phone: nothing is changed or added when already enrolled", () => {
    expect(resolve({ byEmail: foundByEmail("a", { phone: OTHER_PHONE, enrolledRunIds: ["r1"] }) })).toEqual({
      kind: "proceed",
      attendee: { kind: "existing", attendeeId: "a" },
      runId: "r1",
      writes: [],
      warnings: [],
    });
  });

  it("A only, who has no phone: fills in the phone", () => {
    expect(resolve({ byEmail: foundByEmail("a", { enrolledRunIds: ["r1"] }) })).toMatchObject({
      writes: [{ type: "fillPhone", attendeeId: "a", phone: INPUT.phone }],
      warnings: [],
    });
  });

  it("B only, who has no e-mail: fills in the e-mail", () => {
    expect(resolve({ byPhone: foundByPhone("b", { enrolledRunIds: ["r1"] }) })).toMatchObject({
      attendee: { kind: "existing", attendeeId: "b" },
      writes: [{ type: "fillEmail", attendeeId: "b", email: INPUT.email }],
      warnings: [],
    });
  });

  it("B only, who already has a different e-mail: keeps it", () => {
    expect(resolve({ byPhone: foundByPhone("b", { email: OTHER_EMAIL, enrolledRunIds: ["r1"] }) })).toMatchObject({ writes: [] });
  });

  it("enrols a person who is only enrolled in another run, and leaves the old enrolment alone", () => {
    const result = resolve({ byEmail: foundByEmail("a", { phone: OTHER_PHONE, enrolledRunIds: ["r2"] }) });
    expect(result).toMatchObject({ runId: "r1", writes: [enrollExisting("a")] });
  });

  it("does not enrol a person who is already enrolled", () => {
    const result = resolve({ byPhone: foundByPhone("b", { email: OTHER_EMAIL, enrolledRunIds: ["r2", "r1"] }) });
    expect(result).toMatchObject({ writes: [] });
  });

  it("puts the fills before the enrolment", () => {
    expect(resolve({ byEmail: foundByEmail("a") })).toMatchObject({
      writes: [{ type: "fillPhone", attendeeId: "a", phone: INPUT.phone }, enrollExisting("a")],
    });
    expect(resolve({ byPhone: foundByPhone("b") })).toMatchObject({
      writes: [{ type: "fillEmail", attendeeId: "b", email: INPUT.email }, enrollExisting("b")],
    });
  });
});

describe("resolveIdentity: the same person found by e-mail and by phone", () => {
  const same = (enrolledRunIds: string[]) => ({
    byEmail: foundByEmail("p", { phone: INPUT.phone, enrolledRunIds }),
    byPhone: foundByPhone("p", { email: INPUT.email, enrolledRunIds }),
  });

  it("is one person: no warning, nothing to fill, enrolled once if needed", () => {
    expect(resolve(same([]))).toEqual({ kind: "proceed", attendee: { kind: "existing", attendeeId: "p" }, runId: "r1", writes: [enrollExisting("p")], warnings: [] });
    expect(resolve(same(["r1"]))).toEqual({ kind: "proceed", attendee: { kind: "existing", attendeeId: "p" }, runId: "r1", writes: [], warnings: [] });
  });
});

describe("resolveIdentity: two different people", () => {
  const two = (a: Partial<KnownPerson> = {}, b: Partial<KnownPerson> = {}) => ({ byEmail: foundByEmail("a", a), byPhone: foundByPhone("b", b) });

  it("uses A (the e-mail), fills in nothing and warns", () => {
    expect(resolve(two({ enrolledRunIds: ["r1"] }, { enrolledRunIds: ["r1"] }))).toEqual({
      kind: "proceed",
      attendee: { kind: "existing", attendeeId: "a" },
      runId: "r1",
      writes: [],
      warnings: [{ code: "EMAIL_PHONE_CONFLICT", emailPersonId: "a", phonePersonId: "b" }],
    });
  });

  it("fills nothing even though A lacks a phone and B lacks an e-mail", () => {
    const result = resolve(two({ enrolledRunIds: ["r1"] }, { enrolledRunIds: ["r1"] }));
    expect(result).toMatchObject({ writes: [] });
  });

  it("enrols A when A is not enrolled, whatever B's enrolments are", () => {
    expect(resolve(two({}, { enrolledRunIds: ["r1"] }))).toMatchObject({ writes: [enrollExisting("a")] });
    expect(resolve(two({ enrolledRunIds: ["r2"] }, {}))).toMatchObject({ writes: [enrollExisting("a")] });
  });

  it("does not enrol A when A is already enrolled, even if B is not", () => {
    expect(resolve(two({ enrolledRunIds: ["r1"] }, {}))).toMatchObject({ writes: [] });
  });
});

describe("resolveIdentity: names are never changed", () => {
  const lookups: [string, Partial<OpenLookup>][] = [
    ["A only, phone missing", { byEmail: foundByEmail("a") }],
    ["B only, e-mail missing", { byPhone: foundByPhone("b") }],
    ["the same person", { byEmail: foundByEmail("p", { phone: INPUT.phone }), byPhone: foundByPhone("p", { email: INPUT.email }) }],
    ["two people", { byEmail: foundByEmail("a"), byPhone: foundByPhone("b") }],
  ];

  it.each(lookups)("%s: no write except createAttendee carries a name", (_name, lookup) => {
    for (const name of ["Ann Lee", "Someone Else", "x"]) {
      const result = resolve(lookup, "r1", { ...INPUT, name });
      if (result.kind !== "proceed") throw new Error("expected proceed");
      expect(result.writes.length).toBeGreaterThan(0);
      for (const write of result.writes) expect("name" in write).toBe(false);
    }
  });

  it("only createAttendee has a name, and only when nobody was found", () => {
    const result = resolve({});
    if (result.kind !== "proceed") throw new Error("expected proceed");
    expect(result.writes.filter((write) => "name" in write).map((write) => write.type)).toEqual(["createAttendee"]);
  });
});

describe("resolveIdentity: input that is a programming error", () => {
  it.each([
    ["an empty name", { ...INPUT, name: "" }],
    ["a name of only spaces", { ...INPUT, name: "   \t " }],
    ["a phone number without +", { ...INPUT, phone: "0160809580" }],
    ["a phone number that starts +0", { ...INPUT, phone: "+0160809580" }],
    ["a phone number that is too short", { ...INPUT, phone: "+601234" }],
    ["a phone number that is too long", { ...INPUT, phone: "+6016080958012345" }],
    ["an empty phone number", { ...INPUT, phone: "" }],
    ["an empty e-mail", { ...INPUT, email: "" }],
    ["an e-mail that is not lower case", { ...INPUT, email: "Ann@Example.com" }],
  ])("throws RangeError for %s", (_name, input) => {
    expect(() => resolve({}, "r1", input)).toThrow(RangeError);
  });

  it.each([
    ["A whose e-mail is a different one", { byEmail: foundByEmail("a", { email: OTHER_EMAIL }) }],
    ["A without an e-mail", { byEmail: foundByEmail("a", { email: null }) }],
    ["B whose phone is a different one", { byPhone: foundByPhone("b", { phone: OTHER_PHONE }) }],
    ["B without a phone", { byPhone: foundByPhone("b", { phone: null }) }],
  ])("throws RangeError for %s", (_name, lookup) => {
    expect(() => resolve(lookup)).toThrow(RangeError);
  });

  it("checks the input before anything else, also for a kicked person and without a run", () => {
    expect(() => resolve({ byEmail: foundByEmail("a", { status: "KICKED" }) }, null, { ...INPUT, name: "" })).toThrow(RangeError);
    expect(() => resolve({ byEmail: foundByEmail("a", { email: OTHER_EMAIL, status: "KICKED" }) }, null)).toThrow(RangeError);
  });
});

describe("resolveIdentity: purity", () => {
  it("works with frozen input and does not modify it", () => {
    const input = deepFreeze({ ...INPUT });
    const lookup = deepFreeze({ byEmail: foundByEmail("a", { enrolledRunIds: ["r2"] }), byPhone: foundByPhone("b", { enrolledRunIds: ["r1"] }) });
    const snapshot = JSON.stringify([input, lookup]);
    expect(resolveIdentity(input, lookup, "r1")).toMatchObject({ kind: "proceed", attendee: { attendeeId: "a" } });
    expect(JSON.stringify([input, lookup])).toBe(snapshot);
  });

  it("does not depend on the system clock", () => {
    const lookup = { byEmail: foundByEmail("a"), byPhone: null };
    vi.setSystemTime(new Date("1970-01-01T00:00:00Z"));
    const first = resolveIdentity(INPUT, lookup, "r1");
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(resolveIdentity(INPUT, lookup, "r1")).toEqual(first);
  });
});

// deliberately naive reference: the rules of "身份匹配规则" (OPEN) as plain if / else
function reference(input: typeof INPUT, lookup: OpenLookup, enrollable: string | null): unknown {
  const a = lookup.byEmail;
  const b = lookup.byPhone;
  if (a !== null && a.status === "KICKED") return { kind: "rejected", reason: "KICKED" };
  if (b !== null && b.status === "KICKED") return { kind: "rejected", reason: "KICKED" };
  if (enrollable === null) return { kind: "rejected", reason: "NO_RUN" };
  if (a === null && b === null) {
    return {
      kind: "proceed",
      attendee: { kind: "new" },
      runId: enrollable,
      writes: [
        { type: "createAttendee", name: input.name.trim(), phone: input.phone, email: input.email, source: "SELF_REGISTERED" },
        { type: "enroll", runId: enrollable, attendee: { kind: "new" } },
      ],
      warnings: [],
    };
  }
  const writes: unknown[] = [];
  const warnings: unknown[] = [];
  let chosen: KnownPerson;
  if (a !== null && b !== null) {
    chosen = a;
    if (a.id !== b.id) warnings.push({ code: "EMAIL_PHONE_CONFLICT", emailPersonId: a.id, phonePersonId: b.id });
  } else if (a !== null) {
    chosen = a;
    if (a.phone === null) writes.push({ type: "fillPhone", attendeeId: a.id, phone: input.phone });
  } else {
    chosen = b as KnownPerson;
    if (chosen.email === null) writes.push({ type: "fillEmail", attendeeId: chosen.id, email: input.email });
  }
  if (chosen.enrolledRunIds.indexOf(enrollable) === -1) writes.push({ type: "enroll", runId: enrollable, attendee: { kind: "existing", attendeeId: chosen.id } });
  return { kind: "proceed", attendee: { kind: "existing", attendeeId: chosen.id }, runId: enrollable, writes, warnings };
}

describe("resolveIdentity: properties (seeded, repeatable)", () => {
  it("agrees with a naive reference and keeps the safety rules for 8000 random cases", () => {
    const random = mulberry32(20261203);
    const runs = ["r1", "r2", "r3"];
    const randomRuns = () => runs.filter(() => random() < 0.4);
    const status = (): KnownPerson["status"] => (random() < 0.2 ? "KICKED" : "ACTIVE");
    const seen: Record<string, number> = {
      rejectedKicked: 0, rejectedNoRun: 0, created: 0, onlyA: 0, onlyB: 0, same: 0, different: 0, enroll: 0, fillPhone: 0, fillEmail: 0, noWrites: 0,
    };
    const failures: string[] = [];
    for (let i = 0; i < 8000; i++) {
      const scenario = i % 5;
      let byEmail: KnownPerson | null = null;
      let byPhone: KnownPerson | null = null;
      if (scenario === 1) byEmail = foundByEmail("a", { phone: random() < 0.5 ? null : OTHER_PHONE, status: status(), enrolledRunIds: randomRuns() });
      if (scenario === 2) byPhone = foundByPhone("b", { email: random() < 0.5 ? null : OTHER_EMAIL, status: status(), enrolledRunIds: randomRuns() });
      if (scenario === 3) {
        const shared = { status: status(), enrolledRunIds: randomRuns() };
        byEmail = foundByEmail("p", { phone: INPUT.phone, ...shared });
        byPhone = foundByPhone("p", { email: INPUT.email, ...shared });
      }
      if (scenario === 4) {
        byEmail = foundByEmail("a", { phone: random() < 0.5 ? null : OTHER_PHONE, status: status(), enrolledRunIds: randomRuns() });
        byPhone = foundByPhone("b", { email: random() < 0.5 ? null : OTHER_EMAIL, status: status(), enrolledRunIds: randomRuns() });
      }
      const enrollable = random() < 0.2 ? null : runs[Math.floor(random() * runs.length)];
      const lookup = deepFreeze({ byEmail, byPhone });
      const input = deepFreeze({ ...INPUT, name: random() < 0.5 ? "Ann Lee" : "  Someone Else " });

      const actual = resolveIdentity(input, lookup, enrollable);
      const label = `${JSON.stringify(lookup)} enrollable=${enrollable}`;
      if (JSON.stringify(actual) !== JSON.stringify(reference(input, lookup, enrollable))) failures.push(`reference: ${label}`);
      if (JSON.stringify(resolveIdentity(input, lookup, enrollable)) !== JSON.stringify(actual)) failures.push(`not repeatable: ${label}`);

      const anyKicked = (byEmail?.status === "KICKED") || (byPhone?.status === "KICKED");
      if (anyKicked && !(actual.kind === "rejected" && actual.reason === "KICKED")) failures.push(`1: ${label}`);
      if (!anyKicked && enrollable === null && !(actual.kind === "rejected" && actual.reason === "NO_RUN")) failures.push(`2: ${label}`);
      if (actual.kind === "rejected") {
        if ("writes" in actual) failures.push(`3: ${label}`);
        seen[actual.reason === "KICKED" ? "rejectedKicked" : "rejectedNoRun"]++;
        continue;
      }
      const { writes, warnings } = actual;
      const creates = writes.filter((write) => write.type === "createAttendee");
      if ((creates.length === 1) !== (byEmail === null && byPhone === null) || creates.length > 1) failures.push(`4 create: ${label}`);
      for (const write of writes) {
        if (write.type !== "createAttendee" && "name" in write) failures.push(`4 name: ${label}`);
        if (write.type === "fillPhone" && !(byEmail !== null && byPhone === null && byEmail.phone === null && write.attendeeId === byEmail.id && write.phone === INPUT.phone)) failures.push(`4 fillPhone: ${label}`);
        if (write.type === "fillEmail" && !(byPhone !== null && byEmail === null && byPhone.email === null && write.attendeeId === byPhone.id && write.email === INPUT.email)) failures.push(`4 fillEmail: ${label}`);
        if (write.type === "enroll") {
          if (write.runId !== enrollable) failures.push(`4 enroll run: ${label}`);
          const used = byEmail ?? byPhone;
          if (used !== null && used.enrolledRunIds.includes(write.runId)) failures.push(`4 enroll twice: ${label}`);
        }
      }
      if ((warnings.length === 1) !== (byEmail !== null && byPhone !== null && byEmail.id !== byPhone.id) || warnings.length > 1) failures.push(`4 warning: ${label}`);
      if (actual.runId !== enrollable) failures.push(`4 runId: ${label}`);

      if (creates.length === 1) seen.created++;
      else if (byEmail !== null && byPhone === null) seen.onlyA++;
      else if (byEmail === null && byPhone !== null) seen.onlyB++;
      else if (byEmail !== null && byPhone !== null && byEmail.id === byPhone.id) seen.same++;
      else seen.different++;
      if (writes.some((write) => write.type === "enroll")) seen.enroll++;
      if (writes.some((write) => write.type === "fillPhone")) seen.fillPhone++;
      if (writes.some((write) => write.type === "fillEmail")) seen.fillEmail++;
      if (writes.length === 0) seen.noWrites++;
    }
    expect(failures).toEqual([]);
    for (const category of Object.keys(seen)) expect(seen[category], category).toBeGreaterThan(100); // the test is not spinning on a few cases
  });
});
