import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDirectory = fileURLToPath(new URL("../../app/", import.meta.url));

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, `file://${appDirectory}/`), "utf8");
}

describe("Wiki shared UI theme", () => {
  it("loads the shared layers exactly once and in the documented order", async () => {
    const css = await source("app.css");

    expect(css.split("\n")[0]).toBe(
      "@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;",
    );
    expect(css.match(/@import "tailwindcss";/g)).toHaveLength(1);
    expect(css.match(/@import "@gdgjp\/ui\/tailwind\.css";/g)).toHaveLength(1);
    expect(css.match(/@import "@gdgjp\/ui\/components\.css";/g)).toHaveLength(1);
    expect(css.match(/@import "@gdgjp\/ui\/fonts\.css";/g)).toHaveLength(1);
    expect(css.indexOf('@import "tailwindcss";')).toBeLessThan(
      css.indexOf('@import "@gdgjp/ui/tailwind.css";'),
    );
    expect(css.indexOf('@import "@gdgjp/ui/tailwind.css";')).toBeLessThan(
      css.indexOf('@import "@gdgjp/ui/components.css";'),
    );
    expect(css.indexOf('@import "@gdgjp/ui/components.css";')).toBeLessThan(
      css.indexOf('@import "@gdgjp/ui/fonts.css";'),
    );
    expect(css).not.toContain("@theme {");
  });

  it("keeps app CSS limited to documented third-party and domain bridges", async () => {
    const css = await source("app.css");

    expect(css).toContain(".remote-cursor");
    expect(css).toContain(".md-editor-preview");
    expect(css).toContain('article[data-small-text="true"]');
    expect(css).not.toMatch(/(^|\n)\s*\.button\b/);
    expect(css).not.toMatch(/border-radius:\s*\d+px/);
  });

  it("defines one document provider and renders errors inside the shared shell", async () => {
    const root = await source("root.tsx");

    expect(root.match(/<ThemeProvider\b/g)).toHaveLength(1);
    expect(root.match(/<Toaster\b/g)).toHaveLength(1);
    expect(root.match(/storageKey="gdg-apps-theme"/g)).toHaveLength(1);
    expect(root.match(/defaultTheme="system"/g)).toHaveLength(1);
    expect(root.match(/<html\b/g)).toHaveLength(1);
    expect(root.slice(root.indexOf("export function ErrorBoundary")).includes("<html")).toBe(false);
    expect(root).not.toContain("themeInitScript");
  });
});
