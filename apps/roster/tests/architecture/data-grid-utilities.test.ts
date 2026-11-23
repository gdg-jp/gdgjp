import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROSTER_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const OVERRIDDEN_UTILITY = /^(?:[\w-]+:)*!?(?:bg|align)-/;

const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);

function gridComponentFiles(): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(ROSTER_ROOT, relDir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${relDir}/${entry.name}`);
      } else if (entry.name.endsWith(".tsx") && !isTestFile(entry.name)) {
        const relPath = `${relDir}/${entry.name}`;
        if (read(relPath).includes("data-grid")) out.push(relPath);
      }
    }
  };
  walk("app");
  return out;
}

const read = (relPath: string): string => readFileSync(join(ROSTER_ROOT, relPath), "utf8");

const classTokens = (literal: string): string[] =>
  literal
    .replace(/\$\{[^}]*\}/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function stringLiterals(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? "");
}

function tableCellClassNames(source: string): string[] {
  return [
    ...source.matchAll(
      /<t[dh]\b[^>]*?className=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\})/g,
    ),
  ].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

function overriddenGridUtilities(source: string): string[] {
  const offenders: string[] = [];
  for (const literal of stringLiterals(source)) {
    const tokens = classTokens(literal);
    if (!tokens.some((token) => token.startsWith("data-grid-cell"))) continue;
    offenders.push(...tokens.filter((token) => OVERRIDDEN_UTILITY.test(token)));
  }
  for (const className of tableCellClassNames(source)) {
    offenders.push(...classTokens(className).filter((token) => OVERRIDDEN_UTILITY.test(token)));
  }
  return offenders;
}

describe("data-grid cells", () => {
  it("detects utilities that app.css's unlayered grid rules would override", () => {
    expect(
      overriddenGridUtilities(
        [
          '<td className="align-top data-grid-filler" />',
          '<th className={"md:bg-muted"} />',
          "const c = `data-grid-cell ${state} bg-gdg-green/25`;",
          '<span className="rounded-sm bg-gdg-blue/20" />',
        ].join("\n"),
      ),
    ).toEqual(["bg-gdg-green/25", "align-top", "md:bg-muted"]);
  });

  it("styles grid cells and their td/th through app.css classes, not bg-*/align-* utilities", () => {
    const files = gridComponentFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((relPath) =>
      overriddenGridUtilities(read(relPath)).map((token) => `${relPath}: ${token}`),
    );
    expect(
      offenders,
      "Unlayered .data-grid td / .data-grid-cell rules in app/app.css beat Tailwind utilities; add a .data-grid-cell-* class there instead.",
    ).toEqual([]);
  });
});
