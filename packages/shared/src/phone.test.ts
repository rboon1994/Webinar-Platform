import { describe, expect, it } from "vitest";
import { normalizePhone, parsePhone } from "./phone.js";

// small seeded PRNG so the property tests are repeatable
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DB_CHECK = /^\+[1-9][0-9]{6,14}$/;

describe("parsePhone: ready", () => {
  it.each([
    // the same Malaysian mobile number written four ways
    ["0160809580", "MY", "+60160809580", "MY"],
    ["160809580", "MY", "+60160809580", "MY"],
    ["016-080 9580", "MY", "+60160809580", "MY"],
    ["+60160809580", "MY", "+60160809580", "MY"],
    ["012-345 6789", "MY", "+60123456789", "MY"],
    ["+60 012 345 6789", "MY", "+60123456789", "MY"], // redundant trunk 0 after the country code is tolerated
    ["0060160809580", "MY", "+60160809580", "MY"], // 00 international prefix
    ["00 60 16 080 9580", "MY", "+60160809580", "MY"],
    ["  +60160809580  ", "MY", "+60160809580", "MY"],
    ["9123 4567", "SG", "+6591234567", "SG"],
    ["+65 9123 4567", "SG", "+6591234567", "SG"],
    ["13812345678", "CN", "+8613812345678", "CN"],
    ["138-1234-5678", "CN", "+8613812345678", "CN"],
    ["+86 138 1234 5678", "CN", "+8613812345678", "CN"],
    // landlines (realistic numbers) are accepted
    ["03-2123 4567", "MY", "+60321234567", "MY"],
    ["04-222 2222", "MY", "+6042222222", "MY"],
    ["6123 4567", "SG", "+6561234567", "SG"],
    ["010-12345678", "CN", "+861012345678", "CN"],
    // the international form wins over the default country
    ["+6591234567", "MY", "+6591234567", "SG"],
    ["+60160809580", "SG", "+60160809580", "MY"],
    // non-ASCII digits and the full-width plus are converted to an ASCII E.164
    ["０１６０８０９５８０", "MY", "+60160809580", "MY"],
    ["٠١٦٠٨٠٩٥٨٠", "MY", "+60160809580", "MY"],
    ["＋６０１６０８０９５８０", "MY", "+60160809580", "MY"],
    ["+٦٠١٦٠٨٠٩٥٨٠", "SG", "+60160809580", "MY"],
  ])("%j (default %s) is ready as %s", (raw, defaultCountry, e164, country) => {
    expect(parsePhone(raw, defaultCountry as "MY")).toEqual({ status: "ready", e164, country, reasons: [] });
  });

  it("accepts a non-geographic number, which has no country", () => {
    expect(parsePhone("+800 1234 5678", "MY")).toEqual({ status: "ready", e164: "+80012345678", country: null, reasons: [] });
  });
});

describe("parsePhone: review", () => {
  it.each([
    // no + or 00, and the digits equal the E.164 digits: the country code was probably typed already
    ["60160809580", "MY", "+60160809580", "MY"],
    ["65 9123 4567", "SG", "+6591234567", "SG"],
    ["86 138 1234 5678", "CN", "+8613812345678", "CN"],
    // known false positive: "1" in NANP national format is the trunk prefix, not the country code
    ["1-202-555-0123", "US", "+12025550123", "US"],
  ])("%j (default %s) needs review as %s because it looks like it includes the country code", (raw, defaultCountry, e164, country) => {
    expect(parsePhone(raw, defaultCountry as "MY")).toEqual({
      status: "review",
      e164,
      country,
      reasons: ["LOOKS_LIKE_INCLUDES_COUNTRY_CODE"],
    });
  });

  it.each([
    // possible (length fits) but not valid
    ["0160809580", "SG", "+650160809580", "SG"], // a Malaysian number typed with the wrong default country
    ["0160809580", "CN", "+86160809580", "CN"], // same, wrong default country
    ["01234567890", "MY", "+601234567890", "MY"],
    ["12345678", "SG", "+6512345678", "SG"],
    ["03-1234 5678", "MY", "+60312345678", "MY"],
    ["+65 1234 5678", "SG", "+6512345678", "SG"],
    ["+86 123 4567 890", "CN", "+861234567890", "CN"],
    ["6512345678", "SG", "+656512345678", "SG"],
  ])("%j (default %s) needs review as %s because the number is not valid", (raw, defaultCountry, e164, country) => {
    expect(parsePhone(raw, defaultCountry as "MY")).toEqual({ status: "review", e164, country, reasons: ["NOT_VALID_RANGE"] });
  });

  it.each([
    ["602574332826", "MY", "+602574332826"],
    ["652650785807", "SG", "+652650785807"],
  ])("%j (default %s) reports both reasons when the number is not valid and looks like it includes the country code", (raw, defaultCountry, e164) => {
    expect(parsePhone(raw, defaultCountry as "MY")).toEqual({
      status: "review",
      e164,
      country: defaultCountry,
      reasons: ["NOT_VALID_RANGE", "LOOKS_LIKE_INCLUDES_COUNTRY_CODE"],
    });
  });

  it("does not report the country-code reason when the input starts with + or 00", () => {
    expect(parsePhone("+602574332826", "MY").reasons).toEqual(["NOT_VALID_RANGE"]);
    expect(parsePhone("00602574332826", "MY").reasons).toEqual(["NOT_VALID_RANGE"]);
  });
});

describe("parsePhone: invalid", () => {
  it.each([
    ["abc", "CONTAINS_LETTERS"],
    ["012-345 6789 x123", "CONTAINS_LETTERS"],
    ["012-345 6789 ext. 5", "CONTAINS_LETTERS"],
    ["1-800-FLOWERS", "CONTAINS_LETTERS"],
    ["0160809580x5", "CONTAINS_LETTERS"],
    ["０１６０８０９５８０ｘ５", "CONTAINS_LETTERS"], // full-width letter
    ["", "UNPARSEABLE"],
    ["   ", "UNPARSEABLE"],
    ["+60", "UNPARSEABLE"],
    ["+601234567890123456789", "UNPARSEABLE"],
    ["123", "NOT_POSSIBLE"],
    ["0123456", "NOT_POSSIBLE"],
    ["+60 11 1234", "NOT_POSSIBLE"],
    // the library calls these valid, but the result would break the database CHECK
    ["+4957660972710713", "E164_OUT_OF_RANGE"], // 16 digits
    ["+491643", "E164_OUT_OF_RANGE"], // 6 digits
    ["+989628", "E164_OUT_OF_RANGE"], // 6 digits
    ["+2347009848799755", "E164_OUT_OF_RANGE"], // 16 digits
    // the library keeps a zero after the country code the first time, then strips it when the result is parsed again,
    // so the result would not survive being normalized twice
    ["00016821879", "E164_NOT_STABLE"],
    ["+49002783605", "E164_NOT_STABLE"],
    ["+860038443378", "E164_NOT_STABLE"],
  ])("%j is invalid (%s)", (raw, reason) => {
    expect(parsePhone(raw, "MY")).toEqual({ status: "invalid", e164: null, country: null, reasons: [reason] });
  });

  it.each(["XX", "my", "", undefined, "ZZ", "AQ", "001"])("an unknown default country (%j) does not throw", (defaultCountry) => {
    const country = defaultCountry as never;
    // a local number cannot be interpreted without a known default country
    expect(parsePhone("0160809580", country)).toEqual({ status: "invalid", e164: null, country: null, reasons: ["UNPARSEABLE"] });
    // an international number does not need one
    expect(parsePhone("+60160809580", country)).toEqual({ status: "ready", e164: "+60160809580", country: "MY", reasons: [] });
    expect(normalizePhone("0160809580", country)).toBeNull();
    expect(normalizePhone("+60160809580", country)).toBe("+60160809580");
  });
});

describe("parsePhone: layout characters carry no meaning", () => {
  it.each([
    ["en dash", "012\u2013345 6789", "+60123456789"],
    ["em dash", "012\u2014345 6789", "+60123456789"],
    ["minus sign U+2212", "012\u2212345 6789", "+60123456789"],
    ["non-breaking hyphen U+2011", "012\u2011345\u20116789", "+60123456789"],
    ["hyphen U+2010", "012\u2010345 6789", "+60123456789"],
    ["figure dash U+2012", "012\u2012345 6789", "+60123456789"],
    ["full-width hyphen-minus", "012\uff0d345 6789", "+60123456789"],
    ["tab", "016\t080\t9580", "+60160809580"],
    ["trailing non-breaking space", "0160809580\u00a0", "+60160809580"],
    ["narrow no-break space", "016\u202f080\u202f9580", "+60160809580"],
    ["em space", "016\u2003080\u20039580", "+60160809580"],
    ["line separator", "016\u2028080 9580", "+60160809580"],
    ["trailing newline", "016-080 9580\n", "+60160809580"],
    ["LRM before the +", "\u200e+60 16-080 9580", "+60160809580"],
    ["zero-width space after the +60", "+60\u200b160809580", "+60160809580"],
    ["BOM before the number", "\ufeff0160809580", "+60160809580"],
    ["trailing zero-width space", "0160809580\u200b", "+60160809580"],
    ["RLM in the middle", "016\u200f-080 9580", "+60160809580"],
    ["ZWJ in the middle", "016\u200d080 9580", "+60160809580"],
    ["word joiner", "0160809580\u2060", "+60160809580"],
    ["full-width parentheses and ideographic space", "（０１２）３４５\u3000６７８９", "+60123456789"],
    ["ordinary parentheses", "(012) 345 6789", "+60123456789"],
    ["dots", "016.080.9580", "+60160809580"],
  ])("%s is ready as %s", (_name, raw, e164) => {
    expect(parsePhone(raw, "MY")).toEqual({ status: "ready", e164, country: "MY", reasons: [] });
  });

  it("does not take a leading LRM for a missing + (no country-code review)", () => {
    expect(parsePhone("\u200e+60160809580", "MY").reasons).toEqual([]);
  });

  describe("properties (seeded, repeatable)", () => {
    const SPACES = [" ", "\t", "\u00a0", "\u2003", "\u202f", "\u2028", "\u3000", "\u200b ", " \u200b"];
    const DASHES = ["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212", "\ufe63", "\uff0d", "\u058a"];
    const ZERO_WIDTH = ["\u200b", "\u200c", "\u200d", "\u200e", "\u200f", "\u2060", "\ufeff", "\u202a", "\u202c"];

    it.each([
      ["MY", ["", "0", "01", "+60", "+601", "03"]],
      ["SG", ["", "6", "8", "9", "+65", "+659"]],
      ["CN", ["", "1", "13", "0", "+86", "+8613"]],
    ] as const)("replacing spaces and hyphens and inserting zero-width characters never changes the result (%s)", (country, prefixes) => {
      const random = mulberry32(20261017);
      const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
      let readyBases = 0;
      const failures: string[] = [];
      for (let i = 0; i < 2000; i++) {
        let base = prefixes[i % prefixes.length];
        for (let j = 0, length = 4 + Math.floor(random() * 8); j < length; j++) {
          base += Math.floor(random() * 10);
          if (j < length - 1 && random() < 0.3) base += random() < 0.5 ? " " : "-";
        }
        const expected = parsePhone(base, country);
        if (expected.status !== "ready") continue;
        readyBases++;
        let variant = random() < 0.5 ? pick(ZERO_WIDTH) : "";
        for (const char of base) {
          variant += char === " " ? pick(SPACES) : char === "-" ? pick(DASHES) : char;
          if (random() < 0.15) variant += pick(ZERO_WIDTH);
        }
        if (random() < 0.5) variant += pick(SPACES);
        if (JSON.stringify(parsePhone(variant, country)) !== JSON.stringify(expected)) failures.push(`${JSON.stringify(base)} -> ${JSON.stringify(variant)}`);
      }
      expect(failures).toEqual([]);
      expect(readyBases).toBeGreaterThan(50); // the property is not vacuous
    });
  });
});

describe("parsePhone: unexpected characters", () => {
  it.each([
    // the library ignores the extra characters (and only reads the first number), so a person has to look
    ["0160809580号", "+60160809580"],
    ["0160809580 王", "+60160809580"],
    ["0160809580；0123456789", "+60160809580"], // full-width semicolon: only the first number is read
    ["0123456789/", "+60123456789"],
    ["/0123456789", "+60123456789"],
    ["0123456789*", "+60123456789"],
    ["~0160809580", "+60160809580"],
    ["0160809580。", "+60160809580"],
    ["+60160809580号", "+60160809580"],
  ])("%j is review as %s (UNEXPECTED_CHARACTERS)", (raw, e164) => {
    expect(parsePhone(raw, "MY")).toEqual({ status: "review", e164, country: "MY", reasons: ["UNEXPECTED_CHARACTERS"] });
  });

  it("can be combined with the other review reasons", () => {
    expect(parsePhone("60160809580号", "MY").reasons).toEqual(["LOOKS_LIKE_INCLUDES_COUNTRY_CODE", "UNEXPECTED_CHARACTERS"]);
    expect(parsePhone("01234567890号", "MY").reasons).toEqual(["NOT_VALID_RANGE", "UNEXPECTED_CHARACTERS"]);
    expect(parsePhone("00602574332826号", "MY").reasons).toEqual(["NOT_VALID_RANGE", "UNEXPECTED_CHARACTERS"]);
  });

  it.each([
    // the library refuses these outright, so there is no number to review
    ["0123456789/0198765432"],
    ["0123456789,0198765432"],
    ["0123456789 / 0198765432"],
    ["016\u0007080 9580"], // a control character that is not a layout character
    ["\u200b"], // nothing left after the layout characters are removed
  ])("%j is invalid (UNPARSEABLE)", (raw) => {
    expect(parsePhone(raw, "MY")).toEqual({ status: "invalid", e164: null, country: null, reasons: ["UNPARSEABLE"] });
    expect(normalizePhone(raw, "MY")).toBeNull();
  });

  it.each([
    ["0123456789(Ali)"],
    ["0160809580\u200bx"], // a letter next to a zero-width character is still a letter
    ["0160809580 ｘ"], // full-width letter
    ["\u200e0160809580 ext"],
  ])("%j is invalid (CONTAINS_LETTERS)", (raw) => {
    expect(parsePhone(raw, "MY")).toEqual({ status: "invalid", e164: null, country: null, reasons: ["CONTAINS_LETTERS"] });
  });

  it("still returns the E.164 from normalizePhone for review results", () => {
    expect(normalizePhone("0160809580号", "MY")).toBe("+60160809580");
    expect(normalizePhone("0160809580；0123456789", "MY")).toBe("+60160809580");
  });
});

describe("normalizePhone", () => {
  it("returns the E.164 for ready and review results and null for invalid ones", () => {
    expect(normalizePhone("0160809580", "MY")).toBe("+60160809580"); // ready
    expect(normalizePhone("60160809580", "MY")).toBe("+60160809580"); // review
    expect(normalizePhone("0160809580", "SG")).toBe("+650160809580"); // review
    expect(normalizePhone("abc", "MY")).toBeNull(); // invalid
    expect(normalizePhone("+4957660972710713", "MY")).toBeNull(); // invalid
  });

  it("gives the same result for five ways of writing one Malaysian number (default MY)", () => {
    const spellings = ["0160809580", "160809580", "016-080 9580", "+60160809580", "60160809580"];
    expect(new Set(spellings.map((raw) => normalizePhone(raw, "MY")))).toEqual(new Set(["+60160809580"]));
  });

  it("wrong-country cases still return a number; M3's import preview has to suggest a fix", () => {
    // 0160809580 is a Malaysian number. Under SG or CN it parses to a different, invalid number.
    // This is the "wrong default country" situation: S2 flags it as review and does not try to guess.
    expect(normalizePhone("0160809580", "SG")).toBe("+650160809580");
    expect(normalizePhone("0160809580", "CN")).toBe("+86160809580");
    expect(normalizePhone("+60160809580", "SG")).toBe("+60160809580");
  });

  describe("allowedCountries", () => {
    it("is not a restriction when omitted", () => {
      expect(normalizePhone("+8613812345678", "MY")).toBe("+8613812345678");
      expect(normalizePhone("+800 1234 5678", "MY")).toBe("+80012345678");
    });

    it("accepts numbers whose country is in the list", () => {
      expect(normalizePhone("+6591234567", "MY", ["MY", "SG"])).toBe("+6591234567");
      expect(normalizePhone("0160809580", "MY", ["MY"])).toBe("+60160809580");
    });

    it("rejects numbers whose country is not in the list", () => {
      expect(normalizePhone("+8613812345678", "MY", ["MY", "SG"])).toBeNull();
      expect(normalizePhone("0160809580", "SG", ["MY"])).toBeNull(); // review result, country SG
      expect(normalizePhone("0160809580", "SG", ["SG"])).toBe("+650160809580");
    });

    it("rejects a number without a country (non-geographic)", () => {
      expect(normalizePhone("+800 1234 5678", "MY", ["MY", "SG", "CN"])).toBeNull();
    });

    it("rejects everything for an empty list", () => {
      expect(normalizePhone("0160809580", "MY", [])).toBeNull();
    });
  });

  describe("properties (seeded, repeatable)", () => {
    const digits = (random: () => number, min: number, max: number) => {
      let text = "";
      for (let i = 0, length = min + Math.floor(random() * (max - min + 1)); i < length; i++) text += Math.floor(random() * 10);
      return text;
    };
    const inputs = (random: () => number, prefixes: string[], count: number, maxLength: number) =>
      Array.from({ length: count }, (_, i) => prefixes[i % prefixes.length] + digits(random, 4, maxLength));

    const cases: [string, string[]][] = [
      ["MY", ["", "0", "01", "+60", "+601", "03"]],
      ["SG", ["", "6", "8", "9", "+65", "+659"]],
      ["CN", ["", "1", "13", "0", "+86", "+8613"]],
      // countries where the library accepts numbers outside the database CHECK
      ["DE", ["+49"]],
      ["IR", ["+98"]],
      ["NG", ["+234"]],
    ];

    it.each(cases)("every result for %s-style input is consistent and fits the database CHECK", (country, prefixes) => {
      const random = mulberry32(20261016);
      const international = ["DE", "IR", "NG"].includes(country);
      const failures: string[] = [];
      let ready = 0;
      let rejectedByCheck = 0;
      for (const raw of inputs(random, prefixes, 2000, international ? 14 : 11)) {
        const result = parsePhone(raw, (international ? "MY" : country) as "MY");
        const normalized = normalizePhone(raw, (international ? "MY" : country) as "MY");
        const consistent =
          result.status === "invalid"
            ? result.e164 === null && result.country === null && result.reasons.length === 1 && normalized === null
            : result.e164 !== null && DB_CHECK.test(result.e164) && normalized === result.e164 && (result.status === "review") === result.reasons.length > 0;
        if (!consistent) failures.push(raw);
        if (result.status === "ready") ready++;
        if (result.reasons.includes("E164_OUT_OF_RANGE")) rejectedByCheck++;
        // idempotent: normalizing the output again changes nothing, whatever the default country is
        if (normalized !== null && (normalizePhone(normalized, "MY") !== normalized || normalizePhone(normalized, "SG") !== normalized)) failures.push(`${raw} (idempotence)`);
      }
      expect(failures).toEqual([]);
      if (!international) expect(ready).toBeGreaterThan(50); // the property is not vacuous
      if (country === "DE") expect(rejectedByCheck).toBeGreaterThan(0); // the post-check is actually exercised
    });
  });
});
