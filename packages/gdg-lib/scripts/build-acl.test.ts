import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("concurrent ACL builds publish complete output and preserve identical files", async () => {
  const root = await mkdtemp(join(tmpdir(), "gdg-acl-build-"));
  const cwd = join(root, "packages/gdg-lib");
  const target = join(root, "apps/cli/internal/wiki/hooks/acl.ts");
  const script = fileURLToPath(new URL("./build-acl.mjs", import.meta.url));
  const build = () =>
    new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [script], { cwd, stdio: "pipe" });
      child.on("error", reject);
      child.on("close", resolve);
    });
  try {
    await mkdir(join(cwd, "src/acl"), { recursive: true });
    await mkdir(join(root, "apps/cli/internal/wiki/hooks"), { recursive: true });
    await writeFile(join(cwd, "src/acl/agent.ts"), "export const value: number = 42;\n");
    expect(await Promise.all([build(), build()])).toEqual([0, 0]);
    expect(await readFile(target, "utf8")).toContain("value = 42");
    const before = await stat(target);
    expect(await build()).toBe(0);
    expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(join(root, "apps/cli/internal/wiki/hooks"))).toEqual(["acl.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
