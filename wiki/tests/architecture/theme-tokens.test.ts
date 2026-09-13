import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDirectory = fileURLToPath(new URL("../../app/", import.meta.url));

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, `file://${appDirectory}/`), "utf8");
}

describe("Wiki shared UI theme", () => {
  it("loads the shared token, component, and font layers", async () => {
    const css = await source("app.css");

    expect(
      css.startsWith("@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;"),
    ).toBe(true);
    expect(css).toContain('@import "@gdgjp/ui/tailwind.css";');
    expect(css).toContain('@import "@gdgjp/ui/components.css";');
    expect(css).toContain('@import "@gdgjp/ui/fonts.css";');
    expect(css).not.toContain("@theme {");
  });

  it("uses explicit warning tokens for the Google Chat reauthorization card", async () => {
    // The reauthorization card moved to the `/sources` add-source panel in Stage 06.
    const addSourceSection = await source("routes/sources/_components/AddSourceSection.tsx");

    expect(addSourceSection).toContain("border-warning");
    expect(addSourceSection).toContain("var(--gdg-warning-surface)");
    expect(addSourceSection).toContain("text-warning");
  });
});
