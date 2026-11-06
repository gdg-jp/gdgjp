import { execFileSync } from "node:child_process";
import { startCaptureServer } from "./capture-server";

/** Apply D1 migrations, and start the Discord / dead-link stand-in for the delivery spec. */
export default async function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-pr-db", "--local"],
    {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url).pathname,
    },
  );
  const server = await startCaptureServer();
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
