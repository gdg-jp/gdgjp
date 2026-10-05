import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");

describe("build-publish-package", () => {
  execFileSync("node", ["scripts/build-publish-package.mjs"], { cwd: root, stdio: "pipe" });
  const files = readdirSync(distDir).sort();
  const manifest = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8"));

  it("publishes only compiled ACL output, never TypeScript sources or tests", () => {
    for (const file of files) {
      expect(file.endsWith(".ts") && !file.endsWith(".d.ts")).toBe(false);
      expect(file).not.toMatch(/\.test\./);
    }
  });

  it("does not carry workspace-only fields into the published manifest", () => {
    expect(manifest.private).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
  });

  it("keeps the published surface narrow: only ./acl/agent", () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(["./acl/agent"]);
  });

  it("resolves every exports entry to a file that exists in dist/", () => {
    for (const condition of Object.values(manifest.exports) as Record<string, string>[]) {
      for (const target of Object.values(condition)) {
        expect(files).toContain(target.replace(/^\.\//, ""));
      }
    }
  });

  it("rewrites every relative specifier in the emitted JS to an explicit .js extension", () => {
    for (const file of files.filter((f) => f.endsWith(".js"))) {
      const text = readFileSync(join(distDir, file), "utf8");
      const bareSpecifiers = [...text.matchAll(/from "(\.\.?\/[^"]+)"/g)]
        .map(([, spec]) => spec)
        .filter((spec) => !spec.split("/").pop()?.includes("."));
      expect(bareSpecifiers).toEqual([]);
    }
  });

  // The failure mode this guards against is real: an earlier version of this
  // package used `publishConfig.exports` to remap "." to dist/, which `npm pack`
  // silently ignored, and a separate earlier version emitted extensionless
  // relative imports that Node's ESM resolver rejects. Neither was caught by
  // asserting on file lists or manifest JSON alone -- only actually installing
  // the packed tarball into a scratch project with no sibling checkout and
  // importing it through Node's real resolver caught them.
  describe("consumed exactly like an external package (packed, installed, no sibling checkout)", () => {
    const scratchDir = mkdtempSync(join(tmpdir(), "gdg-lib-consumer-"));
    let installedName = "";

    afterAll(() => {
      rmSync(scratchDir, { recursive: true, force: true });
    });

    it("packs, installs from the tarball, and imports ./acl/agent under plain Node ESM", () => {
      const tarballName = execFileSync(
        "npm",
        ["pack", "--silent", "--pack-destination", scratchDir],
        { cwd: distDir, encoding: "utf8" },
      ).trim();
      installedName = manifest.name;

      writeFileSync(
        join(scratchDir, "package.json"),
        `${JSON.stringify({ name: "gdg-lib-consumer-smoke", private: true, type: "module" }, null, 2)}\n`,
      );
      execFileSync(
        "npm",
        ["install", "--no-audit", "--no-fund", "--ignore-scripts", `./${tarballName}`],
        { cwd: scratchDir, stdio: "pipe" },
      );

      writeFileSync(
        join(scratchDir, "smoke.mjs"),
        [
          `import { isSourceVisibility, sourceAudienceKey } from "${installedName}/acl/agent";`,
          `if (typeof isSourceVisibility !== "function") throw new Error("isSourceVisibility missing from ./acl/agent");`,
          `if (typeof sourceAudienceKey !== "function") throw new Error("sourceAudienceKey missing from ./acl/agent");`,
        ].join("\n"),
      );

      expect(() =>
        execFileSync("node", ["smoke.mjs"], { cwd: scratchDir, stdio: "pipe" }),
      ).not.toThrow();

      // Ensure ./acl is NOT exported and fails to import
      writeFileSync(join(scratchDir, "smoke-not-exported.mjs"), `import "${installedName}/acl";`);
      expect(() =>
        execFileSync("node", ["smoke-not-exported.mjs"], { cwd: scratchDir, stdio: "pipe" }),
      ).toThrow();
    });

    it("typechecks against the emitted declarations, including SourceVisibility from ./acl/agent", () => {
      writeFileSync(
        join(scratchDir, "smoke.ts"),
        [
          `import { sourceAudienceKey, type SourceAudienceKey, type SourceVisibility } from "${installedName}/acl/agent";`,
          `const v: SourceVisibility = "member";`,
          "const k: SourceAudienceKey | null = sourceAudienceKey(v, null);",
          "void v; void k;",
        ].join("\n"),
      );
      const tscBin = join(root, "node_modules", ".bin", "tsc");
      expect(() =>
        execFileSync(
          tscBin,
          [
            "--noEmit",
            "--strict",
            "--target",
            "ES2022",
            "--module",
            "nodenext",
            "--moduleResolution",
            "nodenext",
            "--skipLibCheck",
            "smoke.ts",
          ],
          { cwd: scratchDir, stdio: "pipe" },
        ),
      ).not.toThrow();
    });
  });
});
