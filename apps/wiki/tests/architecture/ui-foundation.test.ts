import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const wikiDirectory = fileURLToPath(new URL("../../", import.meta.url));

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, `file://${wikiDirectory}/`), "utf8");
}

describe("Wiki UI foundation", () => {
  it("declares the shared package and has no local primitive directory", async () => {
    const packageJson = JSON.parse(await source("package.json")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["@gdgjp/design-system"]).toBe("workspace:*");
    await expect(
      access(new URL("app/components/ui", `file://${wikiDirectory}/`)),
    ).rejects.toThrow();
  });

  it("keeps foundation consumers on public package paths", async () => {
    const root = await source("app/root.tsx");
    const viteConfig = await source("vite.config.ts");
    expect(root).not.toContain("@gdgjp/design-system/src/");
    expect(viteConfig).not.toContain("@gdgjp/design-system/src/");
    expect(root.match(/from "@gdgjp\/design-system"/g)).toHaveLength(1);
  });

  it("uses a shrink-only, structured migration baseline for later surfaces", async () => {
    const baseline = JSON.parse(
      await source("tests/architecture/ui-conventions-baseline.json"),
    ) as {
      version: number;
      entries: Array<{
        ruleId: string;
        path: string;
        fingerprint: string;
        count: number;
      }>;
    };
    expect(baseline.version).toBe(1);
    expect(baseline.entries.length).toBeGreaterThan(0);
    for (const entry of baseline.entries) {
      expect(entry.path).toMatch(/^apps\/wiki\/app\//);
      expect(entry.ruleId).toMatch(/^[a-z0-9-]+$/);
      expect(entry.fingerprint.trim()).not.toBe("");
      expect(entry.count).toBeGreaterThan(0);
    }
    expect(baseline.entries.some((entry) => entry.path.endsWith("app/root.tsx"))).toBe(false);
  });
});
