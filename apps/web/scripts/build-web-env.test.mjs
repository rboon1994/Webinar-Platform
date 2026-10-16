import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildWebEnv } from "./build-web-env.mjs";

describe("buildWebEnv", () => {
  it("passes the whitelisted variables from the .env text", () => {
    const env = buildWebEnv({ PATH: "p" }, "WEB_PORT=3002\nAPI_URL=http://localhost:4001\n");
    expect(env.WEB_PORT).toBe("3002");
    expect(env.API_URL).toBe("http://localhost:4001");
    expect(env.PATH).toBe("p");
  });

  it("prefers the system environment over the .env text", () => {
    const env = buildWebEnv({ WEB_PORT: "3003" }, "WEB_PORT=3002\nAPI_URL=http://localhost:4001\n");
    expect(env.WEB_PORT).toBe("3003");
    expect(env.API_URL).toBe("http://localhost:4001");
  });

  it("drops DATABASE_URL that appears in the .env text", () => {
    const env = buildWebEnv({}, "WEB_PORT=3002\nDATABASE_URL=sentinel\n");
    expect(env).not.toHaveProperty("DATABASE_URL");
  });

  it("drops DATABASE_URL and TEST_DATABASE_URL set in the system environment", () => {
    const env = buildWebEnv({ DATABASE_URL: "a", TEST_DATABASE_URL: "b", KEEP: "1" }, "");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("TEST_DATABASE_URL");
    expect(env.KEEP).toBe("1");
  });

  it("drops the names case-insensitively (Windows environment names are)", () => {
    const env = buildWebEnv({ Database_Url: "a" }, "");
    expect(Object.keys(env)).toEqual([]);
  });

  it("drops every non-whitelisted key that appears in the .env text", () => {
    const env = buildWebEnv({ FOO: "system", KEEP: "1" }, "FOO=file\nBAR=2\nWEB_PORT=3002\n");
    expect(env).not.toHaveProperty("FOO");
    expect(env).not.toHaveProperty("BAR");
    expect(env.KEEP).toBe("1");
    expect(env.WEB_PORT).toBe("3002");
  });

  it.each([["", "empty"], [undefined, "undefined"], [null, "null"]])(
    "returns only the system environment (secrets removed) when the .env text is %s",
    (text) => {
      const env = buildWebEnv({ PATH: "p", DATABASE_URL: "x" }, text);
      expect(env).toEqual({ PATH: "p" });
    },
  );

  it("neither mutates its input nor writes to process.env", () => {
    const system = { PATH: "p", DATABASE_URL: "x" };
    const before = process.env.API_URL;
    buildWebEnv(system, "API_URL=http://localhost:4001\n");
    expect(system).toEqual({ PATH: "p", DATABASE_URL: "x" });
    expect(process.env.API_URL).toBe(before);
  });

  it("gives a child process WEB_PORT and API_URL but not DATABASE_URL", () => {
    const env = buildWebEnv(
      { ...process.env, TEST_DATABASE_URL: "sentinel-system" },
      "WEB_PORT=3002\nAPI_URL=http://localhost:4001\nDATABASE_URL=sentinel-file\n",
    );
    const probe = "console.log(JSON.stringify([process.env.WEB_PORT, process.env.API_URL, process.env.DATABASE_URL ?? null, process.env.TEST_DATABASE_URL ?? null]))";
    const child = spawnSync(process.execPath, ["-e", probe], { env, encoding: "utf8" });
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(["3002", "http://localhost:4001", null, null]);
  });
});
