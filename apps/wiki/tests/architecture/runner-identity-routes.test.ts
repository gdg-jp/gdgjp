import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The runner token is a full-clearance, all-space credential. It is accepted only by the
 * /api/runner/* routes and the CLI routes the runner's clone / push / verify needs. Adding
 * it anywhere else (editor, sources, agent APIs…) must be a deliberate change to this list.
 */
const WIKI_ROOT = fileURLToPath(new URL("../../", import.meta.url));
function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(WIKI_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...files(rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const ALLOWED = [
  "app/routes/api/cli/agents-md.ts",
  "app/routes/api/cli/attachments.ts",
  "app/routes/api/cli/chat-senders.ts",
  "app/routes/api/cli/snapshot.ts",
  "app/routes/api/cli/source-content.ts",
  "app/routes/api/cli/sources.ts",
  "app/routes/api/cli/sync.ts",
  "app/routes/api/cli/validate-acl.ts",
];

describe("runner identity routes", () => {
  it("accepts the runner token only on the listed CLI routes and /api/runner/*", () => {
    const users = files("app/routes").filter((file) =>
      /getCliOrRunnerIdentity\(|isRunnerRequest\(/.test(
        readFileSync(join(WIKI_ROOT, file), "utf8"),
      ),
    );
    expect(users.sort()).toEqual(ALLOWED);
  });

  it("every /api/runner/* route requires the runner token", () => {
    for (const file of files("app/routes/api/runner")) {
      expect(readFileSync(join(WIKI_ROOT, file), "utf8"), file).toMatch(
        /requireRunner\(request, env\)/,
      );
    }
  });
});
