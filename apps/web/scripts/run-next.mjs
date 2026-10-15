import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const [mode, ...args] = process.argv.slice(2);
if (mode !== "dev" && mode !== "start") {
  console.error("usage: node scripts/run-next.mjs <dev|start> [next args]");
  process.exit(2);
}

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const PORT = String(Number(process.env.WEB_PORT) || 3000);

const child = spawn(process.execPath, [nextBin, mode, ...args], {
  stdio: "inherit",
  env: { ...process.env, PORT },
});

// ponytail: on Windows child.kill() is a hard kill and SIGTERM sent to this script from outside cannot be caught; Ctrl+C reaches the child through the shared console
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

child.on("exit", (code) => process.exit(code ?? 1));
