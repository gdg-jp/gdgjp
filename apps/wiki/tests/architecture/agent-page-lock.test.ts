import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HUMAN_WRITE_PATHS = [
  "app/routes/wiki/edit.tsx",
  "app/features/pages/history.server.ts",
  "app/routes/api/pages/upload-image.ts",
  "workers/app.ts",
];

describe("agent page lock", () => {
  it.each(HUMAN_WRITE_PATHS)("%s checks canHumanEditPage", (file) => {
    expect(readFileSync(join(WIKI_ROOT, file), "utf8")).toMatch(/canHumanEditPage\(/);
  });

  it("/sync rejects page writes from anyone but the runner", () => {
    const sync = readFileSync(join(WIKI_ROOT, "app/routes/api/cli/sync.ts"), "utf8");
    expect(sync).toMatch(
      /if \(!identity\.isRunner && operations\.length > 0\)[\s\S]*agent_pages_runner_only/,
    );
  });
});
