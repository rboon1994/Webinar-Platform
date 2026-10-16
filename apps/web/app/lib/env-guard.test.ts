import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const FORBIDDEN = ["DATABASE_URL", "NEXT_PUBLIC_"];
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\./;

function scan(dir: string): { files: number; hits: string[] } {
  let files = 0;
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !SOURCE.test(entry.name) || TEST_FILE.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    files++;
    const text = readFileSync(file, "utf8");
    for (const word of FORBIDDEN) if (text.includes(word)) hits.push(`${file}: ${word}`);
  }
  return { files, hits };
}

const tmp: string[] = [];
afterEach(() => {
  for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const fixture = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "env-guard-"));
  tmp.push(dir);
  mkdirSync(join(dir, "lib"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

describe("env guard scanner", () => {
  it("flags DATABASE_URL in a source file", () => {
    expect(scan(fixture({ "lib/a.ts": "process.env.DATABASE_URL" })).hits).toHaveLength(1);
  });

  it("flags NEXT_PUBLIC_ in a source file", () => {
    expect(scan(fixture({ "b.tsx": "process.env.NEXT_PUBLIC_X" })).hits).toHaveLength(1);
  });

  it("ignores test files", () => {
    const result = scan(fixture({ "lib/a.test.ts": "DATABASE_URL NEXT_PUBLIC_" }));
    expect(result.hits).toEqual([]);
    expect(result.files).toBe(0);
  });
});

describe("apps/web/app source", () => {
  it("never mentions DATABASE_URL or NEXT_PUBLIC_", () => {
    const result = scan(fileURLToPath(new URL("..", import.meta.url)));
    expect(result.files).toBeGreaterThan(0);
    expect(result.hits).toEqual([]);
  });
});
