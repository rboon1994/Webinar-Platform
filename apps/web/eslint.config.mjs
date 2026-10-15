import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig(
  nextVitals,
  nextTs,
  // lets @next/next find app/ when eslint is run from the repo root
  { settings: { next: { rootDir: import.meta.dirname } } },
  globalIgnores([".next/**", "next-env.d.ts"]),
);
