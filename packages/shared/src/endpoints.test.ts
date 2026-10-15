import { describe, expect, it } from "vitest";
import { healthResponseSchema, timeResponseSchema } from "./endpoints.js";

describe("healthResponseSchema", () => {
  it("accepts { status: 'ok' }", () => {
    expect(healthResponseSchema.safeParse({ status: "ok" }).success).toBe(true);
  });

  it("rejects a status other than 'ok'", () => {
    expect(healthResponseSchema.safeParse({ status: "down" }).success).toBe(false);
  });

  it("rejects a missing status", () => {
    expect(healthResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("timeResponseSchema", () => {
  it("accepts a UTC ISO 8601 string", () => {
    expect(timeResponseSchema.safeParse({ now: "2026-10-15T08:30:00.000Z" }).success).toBe(true);
  });

  it("rejects a +08:00 offset", () => {
    expect(timeResponseSchema.safeParse({ now: "2026-10-15T16:30:00+08:00" }).success).toBe(false);
  });

  it("rejects a string that is not a timestamp", () => {
    expect(timeResponseSchema.safeParse({ now: "not-a-time" }).success).toBe(false);
  });

  it("rejects a missing now", () => {
    expect(timeResponseSchema.safeParse({}).success).toBe(false);
  });
});
