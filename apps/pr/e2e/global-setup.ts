import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { startCaptureServer } from "./capture-server";
import { seedLocalFonts } from "./fonts";
import { startRenderServer } from "./render-server";

export default async function globalSetup() {
  const persistence = process.env.PR_E2E_PERSIST_TO;
  if (!persistence || !isAbsolute(persistence)) {
    throw new Error("Run PR E2E through pnpm test:e2e to isolate persistence");
  }
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "gdgjp-pr-db",
      "--local",
      "--persist-to",
      persistence,
    ],
    {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url).pathname,
    },
  );
  await seedLocalFonts(new URL("..", import.meta.url).pathname, persistence);
  const servers = [await startCaptureServer(), await startRenderServer()];
  return () =>
    Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))).then(
      () => undefined,
    );
}
