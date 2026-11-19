import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Apply D1 migrations so the tables exist before the dev server boots. */
export default function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-meet-db", "--local"],
    {
      stdio: "inherit",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      shell: process.platform === "win32",
    },
  );
}
