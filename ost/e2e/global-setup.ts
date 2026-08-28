import { execFileSync } from "node:child_process";

/**
 * Apply D1 migrations to the local test database before the dev server boots,
 * so `events` / auth tables exist for the specs.
 */
export default function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-ost-db", "--local"],
    { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname },
  );
}
