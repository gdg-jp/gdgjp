import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Apply D1 migrations to the local test database before the dev server boots,
 * so auth/app tables exist for the specs.
 */
export default function globalSetup() {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-discord-relay-db", "--local"],
    { stdio: "inherit", cwd, shell: true },
  );
}
