import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email.js";

// small seeded PRNG so the property test is repeatable
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("normalizeEmail", () => {
  it.each([
    [" Foo@Bar.COM ", "foo@bar.com"],
    ["foo@bar.com", "foo@bar.com"],
    ["\tFoo@Bar.com\n", "foo@bar.com"],
    ["a+Tag@Example.com", "a+tag@example.com"], // + suffix is kept
    ["First.Last@Gmail.com", "first.last@gmail.com"], // Gmail dots are kept
    ["A.B+C@Example.Co.UK", "a.b+c@example.co.uk"],
    ["a.b.c@d.e.f.com", "a.b.c@d.e.f.com"], // single dots anywhere inside are fine
    ["a@b.c", "a@b.c"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeEmail(raw)).toBe(expected);
  });

  it.each([
    ["empty string", ""],
    ["only whitespace", "   "],
    ["no @", "no-at.com"],
    ["two @ in a row", "a@@b.com"],
    ["two @ apart", "a@b@c.com"],
    ["empty local part", "@b.com"],
    ["empty domain", "a@"],
    ["domain without a dot", "a@b"],
    ["domain starting with a dot", "a@.com"],
    ["domain ending with a dot", "a@b."],
    ["domain with two dots in a row", "a@b..com"],
    ["domain with two dots in a row at the end", "a@b.com.."],
    ["local part starting with a dot", ".a@b.com"],
    ["local part ending with a dot", "a.@b.com"],
    ["local part with two dots in a row", "a..b@c.com"],
    ["space in the local part", "a b@c.com"],
    ["space in the domain", "a@b .com"],
    ["tab inside", "a\t@b.com"],
    ["non-breaking space inside", "a\u00a0b@c.com"],
    ["non-ASCII local part", "é@x.com"],
    ["non-ASCII domain", "a@bücher.de"],
    ["CJK address", "用户@例子.广告"],
    ["full-width letter", "ａ@b.com"],
    ["NUL character", "a\u0000@b.com"],
    ["other control character", "a\u001f@b.com"],
  ])("returns null for %s", (_name, raw) => {
    expect(normalizeEmail(raw)).toBeNull();
  });

  it("accepts exactly 254 characters and rejects 255", () => {
    const at254 = "a".repeat(254 - "@b.co".length) + "@b.co";
    expect(at254).toHaveLength(254);
    expect(normalizeEmail(at254)).toBe(at254);
    expect(normalizeEmail(` ${at254} `)).toBe(at254); // length is measured after trimming
    expect(normalizeEmail("a" + at254)).toBeNull();
  });

  it("only returns ASCII results that equal their own lower case, and is idempotent", () => {
    const random = mulberry32(2026);
    const alphabet = "abcXYZ019@@..++--_ \tÉßİｗ用";
    let accepted = 0;
    const failures: string[] = [];
    for (let i = 0; i < 2000; i++) {
      let raw = "";
      for (let j = 0, length = 1 + Math.floor(random() * 20); j < length; j++) raw += alphabet[Math.floor(random() * alphabet.length)];
      // make about half of the inputs plausible addresses so the accepted branch is exercised
      if (i % 2 === 0) raw = `${raw.replace(/[^a-zA-Z0-9]/g, "x")}@${raw.slice(0, 3).replace(/[^a-zA-Z0-9]/g, "y")}.Com`;
      const result = normalizeEmail(raw);
      if (result === null) continue;
      accepted++;
      if (!/^[\x20-\x7e]+$/.test(result) || result !== result.toLowerCase() || normalizeEmail(result) !== result) failures.push(raw);
    }
    expect(failures).toEqual([]);
    expect(accepted).toBeGreaterThan(500);
  });
});
