import { execFileSync } from "node:child_process";

/** Apply D1 migrations so the tables exist before the dev server boots. */
export default function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-roulette-db", "--local"],
    {
      stdio: "inherit",
      cwd: new URL("..", import.meta.url).pathname,
    },
  );
}
