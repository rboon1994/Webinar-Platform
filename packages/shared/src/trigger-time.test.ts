import { describe, expect, it } from "vitest";
import { parseTriggerSeconds } from "./trigger-time.js";

describe("parseTriggerSeconds", () => {
  it.each([
    ["90", 90],
    [" 90 ", 90],
    ["0", 0],
    ["007", 7],
    ["90.6", 91], // fractions round to whole seconds
    ["90.5", 91],
    ["0.4", 0],
    [90, 90],
    [90.6, 91],
    [0.4, 0],
    [0, 0],
    ["1:30", 90],
    ["01:30", 90],
    ["1：30", 90], // full-width colon
    ["90:00", 5400], // two parts: minutes may exceed 59
    ["100:30", 6030],
    ["1:02:03", 3723],
    ["01:02:03", 3723],
    ["1：02：03", 3723],
    ["10:00:00", 36000],
    ["100:59:59", 363599], // three parts: hours are unbounded
    ["1:59.6", 120], // seconds may carry a fraction (checked < 60 before rounding)
    ["0:00.4", 0],
    ["1:5", 65], // a one-digit second part is accepted
  ])("parses %j to %j", (input, expected) => {
    expect(parseTriggerSeconds(input)).toBe(expected);
  });

  it("returns +0 for -0", () => {
    expect(Object.is(parseTriggerSeconds(-0), 0)).toBe(true);
  });

  it.each([
    ["empty string", ""],
    ["only whitespace", "   "],
    ["negative number", -1],
    ["negative number that would round to 0", -0.4],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["negative string", "-5"],
    ["positive-signed string", "+5"],
    ["negative zero string", "-0"],
    ["the string NaN", "NaN"],
    ["the string Infinity", "Infinity"],
    ["a string that overflows to Infinity", "9".repeat(400)],
    ["scientific notation", "1e3"],
    ["hex", "0x10"],
    ["letters", "abc"],
    ["unit suffix", "90s"],
    ["letter in a segment", "1:3a"],
    ["seconds = 60", "1:60"],
    ["seconds > 60", "1:75"],
    ["minutes = 60 with three parts", "1:60:00"],
    ["minutes > 60 with three parts", "1:75:00"],
    ["seconds = 60 with three parts", "1:2:60"],
    ["four parts", "1:2:3:4"],
    ["empty first part", ":30"],
    ["empty last part", "1:"],
    ["empty middle part", "1::30"],
    ["trailing colon with three parts", "1:2:"],
    ["fractional minutes", "1.5:30"],
    ["leading-dot fraction", ".5"],
    ["trailing-dot fraction", "5."],
    ["comma decimal", "1,5"],
    ["space inside", "1 :30"],
    ["Arabic-Indic digits", "١٢"],
    ["full-width digits", "１:３０"],
  ])("returns null for %s", (_name, input) => {
    expect(parseTriggerSeconds(input)).toBeNull();
  });

  it("does not accept a Date", () => {
    expect(parseTriggerSeconds(new Date(0) as never)).toBeNull();
  });

  describe("maxSeconds", () => {
    it.each([
      ["90", 90, 90],
      ["90", 100, 90],
      [90.4, 90, 90], // the limit applies after rounding
      ["0", 0, 0],
    ])("accepts %j with maxSeconds %j", (input, maxSeconds, expected) => {
      expect(parseTriggerSeconds(input, { maxSeconds })).toBe(expected);
    });

    it.each([
      ["91", 90],
      [90.6, 90],
      ["1:30", 89],
      ["1", 0],
    ])("returns null for %j with maxSeconds %j", (input, maxSeconds) => {
      expect(parseTriggerSeconds(input, { maxSeconds })).toBeNull();
    });

    it("has no limit when maxSeconds is omitted", () => {
      expect(parseTriggerSeconds("99999")).toBe(99999);
    });
  });

  it("agrees with the arithmetic for every m:ss and h:mm:ss combination in range", () => {
    const failures: string[] = [];
    for (let m = 0; m <= 200; m++)
      for (let s = 0; s < 60; s++) {
        const padded = `${m}:${String(s).padStart(2, "0")}`;
        if (parseTriggerSeconds(padded) !== m * 60 + s) failures.push(padded);
      }
    for (let h = 0; h <= 3; h++)
      for (let m = 0; m < 60; m++)
        for (let s = 0; s < 60; s += 7) {
          const text = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
          if (parseTriggerSeconds(text) !== h * 3600 + m * 60 + s) failures.push(text);
        }
    expect(failures).toEqual([]);
  });
});
