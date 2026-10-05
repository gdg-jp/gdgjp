import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function routeSource(name: string): string {
  return readFileSync(new URL(`../../app/routes/${name}`, import.meta.url), "utf8");
}

function appSource(name: string): string {
  return readFileSync(new URL(`../../app/${name}`, import.meta.url), "utf8");
}

describe("conversation source surface exclusions", () => {
  it("filters conversation sources at database query time in all three surfaces", () => {
    // The `/sources` loader query moved to the feature layer in Stage 06.
    const page = appSource("features/sources/sources-page.server.ts");
    const json = routeSource("api/sources/list.ts");
    const manifest = routeSource("api/cli/sources.ts");

    expect(page).toMatch(/\.where\(ne\(schema\.sources\.kind, "conversation"\)\)/);
    expect(json).toMatch(/\.where\(ne\(schema\.sources\.kind, "conversation"\)\)/);
    expect(manifest).toMatch(/ne\(schema\.sources\.kind, "conversation"\)/);
  });

  it("emits chapterId for source and wiki-human manifest entries", () => {
    const manifest = routeSource("api/cli/sources.ts");
    expect(manifest).toMatch(/chapterId: source\.chapterId/);
    expect(manifest).toMatch(/chapterId: null/);
  });
});
