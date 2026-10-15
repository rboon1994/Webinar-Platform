import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth, fetchTime } from "./api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
});

describe("fetchHealth", () => {
  it("returns the parsed body on a valid 200", async () => {
    reply({ status: "ok" });
    await expect(fetchHealth()).resolves.toEqual({ status: "ok" });
  });

  it("requests API_URL/health with cache: no-store", async () => {
    vi.stubEnv("API_URL", "http://api.test:1234");
    reply({ status: "ok" });
    await fetchHealth();
    expect(fetchMock).toHaveBeenCalledWith("http://api.test:1234/health", { cache: "no-store" });
  });

  it("defaults API_URL to http://localhost:4000", async () => {
    vi.stubEnv("API_URL", "");
    reply({ status: "ok" });
    await fetchHealth();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/health", { cache: "no-store" });
  });

  it("throws when the HTTP status is not 200", async () => {
    reply({ status: "ok" }, 503);
    await expect(fetchHealth()).rejects.toThrow("503");
  });

  it("throws when the body does not match the schema", async () => {
    reply({ status: "down" });
    await expect(fetchHealth()).rejects.toThrow();
  });

  it("throws when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));
    await expect(fetchHealth()).rejects.toThrow("ECONNREFUSED");
  });
});

describe("fetchTime", () => {
  it("returns the parsed body on a valid 200", async () => {
    reply({ now: "2026-10-15T08:30:00.000Z" });
    await expect(fetchTime()).resolves.toEqual({ now: "2026-10-15T08:30:00.000Z" });
  });

  it("throws when the HTTP status is not 200", async () => {
    reply({ now: "2026-10-15T08:30:00.000Z" }, 500);
    await expect(fetchTime()).rejects.toThrow("500");
  });

  it("throws when now has a non-UTC offset", async () => {
    reply({ now: "2026-10-15T16:30:00+08:00" });
    await expect(fetchTime()).rejects.toThrow();
  });

  it("throws when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(fetchTime()).rejects.toThrow();
  });
});
