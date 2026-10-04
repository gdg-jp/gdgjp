import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const app = dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(app);
const imports = files.flatMap((file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const named = clause?.namedBindings;
    const typeOnly =
      clause?.isTypeOnly ||
      (!clause?.name &&
        named &&
        ts.isNamedImports(named) &&
        named.elements.every((s) => s.isTypeOnly));
    const base = specifier.startsWith("~/")
      ? resolve(app, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : null;
    const target = base
      ? files.find((candidate) => candidate === `${base}.ts` || candidate === `${base}.tsx`)
      : undefined;
    return [{ file: relative(app, file), specifier, typeOnly, target }];
  });
});

describe("accounts architecture", () => {
  it("keeps domain logic out of the shared primitive directory", () => {
    expect(
      sourceFiles(resolve(app, "lib"))
        .map((file) => relative(app, file))
        .sort(),
    ).toEqual([
      "lib/crypto.server.ts",
      "lib/i18n/i18n.server.ts",
      "lib/i18n/resources.ts",
      "lib/route-args.ts",
      "lib/route-data.ts",
    ]);
  });

  it("keeps composed screens in domain route modules", () => {
    expect(files.filter((file) => /^features\/[^/]+\/pages\//.test(relative(app, file)))).toEqual(
      [],
    );
    expect(files.filter((file) => relative(app, file).includes("/_pages/"))).toEqual([]);
    expect(files.filter((file) => file.endsWith("-page.tsx"))).toEqual([]);
  });

  it("keeps reusable primitives independent of domain and application composition", () => {
    expect(
      imports.filter(
        ({ file, specifier }) =>
          file.startsWith("components/") && /~\/(features|layouts|routes)\//.test(specifier),
      ),
    ).toEqual([]);
  });

  it("keeps feature dependencies pointing away from routes and widgets away from pages", () => {
    expect(
      imports.filter(
        ({ file, specifier, target }) =>
          file.startsWith("features/") &&
          (specifier.startsWith("~/routes/") ||
            (target && relative(app, target).startsWith("routes/")) ||
            (file.includes("/components/") && specifier.includes("/_pages/"))),
      ),
    ).toEqual([]);
  });

  it("keeps server implementations outside runtime UI dependencies", () => {
    expect(
      imports.filter(
        ({ file, specifier, typeOnly }) =>
          !typeOnly &&
          (((file.includes("/components/") || file.startsWith("layouts/")) &&
            specifier.endsWith(".server")) ||
            (file.endsWith(".server.ts") &&
              (specifier === "@gdgjp/ui" ||
                specifier.includes("/_pages/") ||
                specifier.includes("/components/")))),
      ),
    ).toEqual([]);
  });

  it("has no runtime module cycles", () => {
    const graph = new Map(files.map((file) => [relative(app, file), [] as string[]]));
    for (const entry of imports) {
      if (entry.target && !entry.typeOnly) graph.get(entry.file)?.push(relative(app, entry.target));
    }
    const active = new Set<string>();
    const visited = new Set<string>();
    function visit(file: string): void {
      expect(active.has(file), `runtime cycle through ${file}`).toBe(false);
      if (visited.has(file)) return;
      active.add(file);
      for (const dependency of graph.get(file) ?? []) visit(dependency);
      active.delete(file);
      visited.add(file);
    }
    for (const file of graph.keys()) visit(file);
  });
});
