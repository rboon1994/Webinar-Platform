import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildWebEnv } from "./build-web-env.mjs";

const [mode, ...args] = process.argv.slice(2);
if (mode !== "dev" && mode !== "start") {
  console.error("usage: node scripts/run-next.mjs <dev|start> [next args]");
  process.exit(2);
}

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
let rootEnvText = "";
try {
  rootEnvText = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const env = buildWebEnv(process.env, rootEnvText);
const PORT = String(Number(env.WEB_PORT) || 3000);

const child = spawn(process.execPath, [nextBin, mode, ...args], {
  stdio: "inherit",
  env: { ...env, PORT },
});

// ponytail: on Windows child.kill() is a hard kill and SIGTERM sent to this script from outside cannot be caught; Ctrl+C reaches the child through the shared console
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

child.on("exit", (code) => process.exit(code ?? 1));
