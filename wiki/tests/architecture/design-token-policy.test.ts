import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_DIRECTORY = fileURLToPath(new URL("../../app/", import.meta.url));
// `components/` and `routes/` are wholly UI. Under `features/` only the
// `*/components/` subtrees are UI — feature `*.server.ts` (email HTML, colour
// parsing) legitimately carries colour literals and must not be scanned.
const UI_DIRECTORIES = ["components", "routes"];
const FEATURE_COMPONENTS_ROOT = "features";
const UI_ROOT_FILES = ["root.tsx"];
const EXCEPTION = "design-token-policy: allow-dynamic-color";

const DEFAULT_COLOR =
  "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";
const FORBIDDEN_TAILWIND_COLOR = new RegExp(
  `(?:^|[\\s\\"':])-?(?:bg|text|border|outline|ring|divide|from|via|to|fill|stroke|shadow|decoration|caret|accent)-${DEFAULT_COLOR}-(?:[0-9]{2,3})(?:\\/[0-9]+)?(?:$|[\\s\\"'])`,
  "g",
);
const FORBIDDEN_NEUTRAL_TAILWIND_COLOR =
  /(?:^|[\s"':])-?(?:bg|text|border|outline|ring|divide|from|via|to|fill|stroke|shadow|decoration|caret|accent)-(?:black|white)(?:$|[\s"'])/g;
const FORBIDDEN_COLOR_LITERAL = /(?<!&)#[\da-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch|oklab)\(/g;

async function findUiFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findUiFiles(path);
      return entry.isFile() && /(?<!\.test)\.(?:ts|tsx)$/.test(path) ? [path] : [];
    }),
  );
  return files.flat();
}

function violationsIn(source: string): string[] {
  return source.split("\n").flatMap((line, index) => {
    if (line.includes(EXCEPTION)) return [];
    const matches = [
      ...line.matchAll(FORBIDDEN_TAILWIND_COLOR),
      ...line.matchAll(FORBIDDEN_NEUTRAL_TAILWIND_COLOR),
      ...line.matchAll(FORBIDDEN_COLOR_LITERAL),
    ].map((match) => match[0].trim());
    return matches.map((match) => `${index + 1}: ${match}`);
  });
}

describe("Wiki UI color-token policy", () => {
  it("uses semantic tokens instead of palette utilities or fixed colors", async () => {
    const componentFiles = await Promise.all(
      UI_DIRECTORIES.map((directory) => findUiFiles(join(APP_DIRECTORY, directory))),
    );
    const featureComponentFiles = (
      await findUiFiles(join(APP_DIRECTORY, FEATURE_COMPONENTS_ROOT))
    ).filter((file) => file.includes(`${sep}components${sep}`));
    const files = [
      ...componentFiles.flat(),
      ...featureComponentFiles,
      ...UI_ROOT_FILES.map((file) => join(APP_DIRECTORY, file)),
    ];
    const violations = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(file, "utf8");
          return violationsIn(source).map(
            (violation) => `${relative(APP_DIRECTORY, file)}:${violation}`,
          );
        }),
      )
    ).flat();

    expect(
      violations,
      `Replace these with semantic tokens from app.css. ${EXCEPTION} is permitted only for user- or API-provided color data.`,
    ).toEqual([]);
  });
});
