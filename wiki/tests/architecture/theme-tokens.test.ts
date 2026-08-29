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
    const sourcesRoute = await source("routes/sources/page.tsx");

    expect(sourcesRoute).toContain("border-feedback-warning-border");
    expect(sourcesRoute).toContain("bg-feedback-warning-surface");
    expect(sourcesRoute).toContain("text-feedback-warning-foreground");
  });
});
