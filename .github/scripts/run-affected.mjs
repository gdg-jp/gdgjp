import { spawnSync } from "node:child_process";
import { classifyChanges } from "./changed-workspaces.mjs";

try {
  const [task, ...extra] = process.argv.slice(2);
  if (!["typecheck", "test", "build"].includes(task) || extra.length) {
    throw new Error("Usage: node .github/scripts/run-affected.mjs <typecheck|test|build>");
  }
  const workspaces = JSON.parse(process.env.WORKSPACES ?? "null");
  const allowed = new Set(classifyChanges([], { forceAll: true }).ci);
  if (
    !Array.isArray(workspaces) ||
    workspaces.length === 0 ||
    workspaces.some((workspace) => !allowed.has(workspace))
  ) {
    throw new Error("WORKSPACES must be a nonempty JSON array of CI workspace names");
  }
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      task,
      ...[...new Set(workspaces)].map((workspace) => `--filter=${workspace}`),
      "--concurrency=6",
      "--output-logs=errors-only",
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
