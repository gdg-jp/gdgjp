import { execFileSync } from "node:child_process";

/** Apply D1 migrations so the RP auth tables exist before the dev server boots. */
export default function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-screen-db", "--local"],
    {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url).pathname,
    },
  );
}
