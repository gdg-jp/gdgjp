import { execFileSync } from "node:child_process";
import { startCaptureServer } from "./capture-server";
import { startRenderServer } from "./render-server";

/** Apply D1 migrations; start the Discord / dead-link stand-in and the local image renderer. */
export default async function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-pr-db", "--local"],
    {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url).pathname,
    },
  );
  const servers = [await startCaptureServer(), await startRenderServer()];
  return () =>
    Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))).then(
      () => undefined,
    );
}
