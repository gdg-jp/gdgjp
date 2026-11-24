import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-sns-db", "--local"],
    {
      stdio: "inherit",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      shell: process.platform === "win32",
    },
  );
}
