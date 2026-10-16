import { fileURLToPath } from "node:url";

// src/ and dist/ both sit one level below apps/api, so the repo root is three levels up from either
export const defaultRootEnvPath = () => fileURLToPath(new URL("../../../.env", import.meta.url));

// existing environment variables win (Node does not override them); only a missing file is ignored
export function loadEnvFile(path: string): void {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

loadEnvFile(defaultRootEnvPath());
