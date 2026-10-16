import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultRootEnvPath, loadEnvFile } from "../src/load-env.js";

// Jest gives each test file a copy of process.env, and process.loadEnvFile writes to the real one,
// so the "does it set variables" cases run in a plain Node child that imports the module directly.
const MODULE_URL = pathToFileURL(fileURLToPath(new URL("../src/load-env.ts", import.meta.url))).href;
const CHILD = `
  const { loadEnvFile, defaultRootEnvPath } = await import(process.env.S1_MODULE);
  loadEnvFile(process.env.S1_FILE);
  console.log(JSON.stringify({ loaded: process.env.S1_LOADED ?? null, keep: process.env.S1_KEEP ?? null, rootEnv: defaultRootEnvPath() }));
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "load-env-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeEnv = (text: string) => {
  const file = join(dir, ".env");
  writeFileSync(file, text);
  return file;
};

const runInChild = (file: string, options: { env?: Record<string, string>; cwd?: string } = {}) => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD], {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, ...options.env, S1_MODULE: MODULE_URL, S1_FILE: file },
  });
  expect(child.stderr).not.toMatch(/Error/);
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout) as { loaded: string | null; keep: string | null; rootEnv: string };
};

describe("loadEnvFile", () => {
  it("loads variables from the file into process.env", () => {
    expect(runInChild(writeEnv("S1_LOADED=from_file\n")).loaded).toBe("from_file");
  });

  it("does not override a variable that already exists", () => {
    const result = runInChild(writeEnv("S1_KEEP=from_file\n"), { env: { S1_KEEP: "from_system" } });
    expect(result.keep).toBe("from_system");
  });

  it("ignores a file that does not exist", () => {
    expect(() => loadEnvFile(join(dir, "missing.env"))).not.toThrow();
  });

  it("rethrows errors other than a missing file (target is a directory)", () => {
    expect(() => loadEnvFile(dir)).toThrow();
  });

  it("gives the same result from a different working directory", () => {
    const result = runInChild(writeEnv("S1_LOADED=from_file\n"), { cwd: tmpdir() });
    expect(result.loaded).toBe("from_file");
    expect(result.rootEnv).toBe(defaultRootEnvPath());
  });
});

describe("defaultRootEnvPath", () => {
  it("points to the .env in the repository root", () => {
    const path = defaultRootEnvPath();
    const root = dirname(path);
    expect(basename(path)).toBe(".env");
    expect(existsSync(join(root, "pnpm-workspace.yaml"))).toBe(true);
    expect(existsSync(join(root, "apps", "api", "package.json"))).toBe(true);
  });
});
