import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = mkdtempSync(join(tmpdir(), "gdg-lib-dist-"));

describe("build-publish-package", () => {
  afterAll(() => {
    rmSync(distDir, { recursive: true, force: true });
  });
  execFileSync("node", ["scripts/build-publish-package.mjs", distDir], {
    cwd: root,
    stdio: "pipe",
  });
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

  it("ships a README stating that span ACLs are not a security boundary", () => {
    expect(files).toContain("README.md");
    const readme = readFileSync(join(distDir, "README.md"), "utf8");
    expect(readme).toContain("Span ACLs are not a security boundary");
    expect(readme).toContain("canClassesAccessSourceInChannel");
    expect(readme).toContain("canClassesSeePageInChannel");
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
      expect(
        readFileSync(join(scratchDir, "node_modules", installedName, "README.md"), "utf8"),
      ).toContain("Span ACLs are not a security boundary");

      writeFileSync(join(scratchDir, "smoke-not-exported.mjs"), `import "${installedName}/acl";`);
      expect(() =>
        execFileSync("node", ["smoke-not-exported.mjs"], { cwd: scratchDir, stdio: "pipe" }),
      ).toThrow();
    }, 60_000);

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
      const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
      expect(() =>
        execFileSync(
          process.execPath,
          [
            tsc,
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
    }, 60_000);
  });
});
