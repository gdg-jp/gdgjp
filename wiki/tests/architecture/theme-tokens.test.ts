import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDirectory = fileURLToPath(new URL("../../app/", import.meta.url));

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, `file://${appDirectory}/`), "utf8");
}

describe("Wiki semantic color theme", () => {
  it("defines every feedback role for light and dark themes", async () => {
    const css = await source("app.css");
    const theme = css.slice(css.indexOf("@theme"), css.indexOf(":root"));
    const dark = css.slice(css.indexOf(".dark {"), css.indexOf("/* Shared motion layer"));

    for (const role of ["info", "success", "warning", "danger"]) {
      for (const slot of ["surface", "border", "foreground", "solid", "solid-foreground"]) {
        expect(theme).toContain(`--color-feedback-${role}-${slot}:`);
        expect(css).toContain(`--feedback-${role}-${slot}:`);
        expect(dark).toContain(`--feedback-${role}-${slot}:`);
      }
    }
  });

  it("uses explicit warning tokens for the Google Chat reauthorization card", async () => {
    // The reauthorization card moved to the `/sources` add-source panel in Stage 06.
    const addSourceSection = await source("routes/sources/_components/AddSourceSection.tsx");

    expect(addSourceSection).toContain("border-feedback-warning-border");
    expect(addSourceSection).toContain("bg-feedback-warning-surface");
    expect(addSourceSection).toContain("text-feedback-warning-foreground");
  });
});
