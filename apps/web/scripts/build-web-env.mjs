import { parseEnv } from "node:util";

const WHITELIST = ["WEB_PORT", "API_URL"];
const SECRETS = ["DATABASE_URL", "TEST_DATABASE_URL"];

// Environment for the Next child process: system env + whitelisted keys from the root .env,
// minus every other key named in the .env and the database URLs. The .env is parsed, never loaded
// into this process. Names are compared case-insensitively because Windows environment names are.
export function buildWebEnv(processEnv, rootEnvText) {
  const fromFile = rootEnvText ? parseEnv(rootEnvText) : {};
  const env = { ...processEnv };
  for (const key of WHITELIST) if (env[key] === undefined && fromFile[key] !== undefined) env[key] = fromFile[key];
  const dropped = new Set([...SECRETS, ...Object.keys(fromFile).filter((key) => !WHITELIST.includes(key))].map((key) => key.toUpperCase()));
  for (const key of Object.keys(env)) if (dropped.has(key.toUpperCase())) delete env[key];
  return env;
}
