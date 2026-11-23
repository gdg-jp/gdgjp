import { execFileSync } from "node:child_process";

export default function globalSetup() {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "gdgjp-ost-db", "--local"],
    { stdio: "inherit", cwd: new URL("..", import.meta.url).pathname },
  );
}
