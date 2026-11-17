import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const setup = fileURLToPath(new URL("../../apps/wiki/tests/e2e/setup.ts", import.meta.url));

test("fresh Wiki setup streams large migration output and still validates fixture counts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wiki-e2e-setup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tests/e2e"), { recursive: true });
  writeFileSync(join(root, "tests/e2e/seed.sql"), "SELECT 1;\n");
  writeFileSync(
    join(root, "pnpm"),
    `#!${process.execPath}
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify([3,1,0].map(count => ({ results: [{ count }] }))));
} else if (process.argv.includes("migrations")) {
  process.stdout.write("migration output\\n".repeat(150000));
}
`,
    { mode: 0o700 },
  );
  const result = spawnSync(process.execPath, [setup], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${root}${delimiter}${process.env.PATH}`,
      WIKI_E2E_SESSION_SECRET: "fixture-wiki-e2e-secret",
      WIKI_E2E_ISSUER: "http://localhost:6173",
      WIKI_E2E_PERSIST_TO: ".wrangler/e2e-state",
    },
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(readFileSync(join(root, "tests/e2e/storage-state/author.json"), "utf8"));
  assert.equal(state.cookies[0].name, "gdgjp-wiki-session");
  assert.equal(state.cookies[0].domain, "localhost");
});
