import { execFileSync } from "node:child_process";
import { startCaptureServer } from "./capture-server";
import { seedLocalFonts } from "./fonts";
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
  // The local D1 is shared with earlier runs: a queued job left by an aborted test would be the
  // next job a test's runner stand-in leases, so none may be waiting when a run starts.
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "gdgjp-pr-db",
      "--local",
      "--command",
      "UPDATE agent_jobs SET status = 'expired' WHERE status IN ('queued', 'leased')",
    ],
    { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname },
  );
  await seedLocalFonts(new URL("..", import.meta.url).pathname);
  const servers = [await startCaptureServer(), await startRenderServer()];
  return () =>
    Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))).then(
      () => undefined,
    );
}
