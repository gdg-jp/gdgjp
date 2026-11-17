import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const persistence = mkdtempSync(join(tmpdir(), "gdgjp-pr-e2e-"));
const registry = join(persistence, "registry");
mkdirSync(registry);
const child = spawn("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    PR_E2E_PERSIST_TO: persistence,
    PR_REAL_SERVICES: "",
    MINIFLARE_REGISTRY_PATH: registry,
    WRANGLER_REGISTRY_PATH: registry,
  },
  detached: process.platform !== "win32",
  stdio: "inherit",
});
let receivedSignal;
function forward(signal) {
  receivedSignal = signal;
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") console.error(error.message);
  }
}
const interrupt = () => forward("SIGINT");
const terminate = () => forward("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
try {
  process.exitCode = await new Promise((resolve) => {
    child.on("error", (error) => console.error(error.message));
    child.on("close", (code, signal) => {
      const ending = receivedSignal ?? signal;
      resolve(
        code !== null && code >= 0
          ? code
          : ending === "SIGINT"
            ? 130
            : ending === "SIGTERM"
              ? 143
              : 1,
      );
    });
  });
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  rmSync(persistence, { recursive: true, force: true });
}
