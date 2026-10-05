import ts from "typescript";
import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>(["/app/**/*.{ts,tsx}", "!/app/**/*.test.{ts,tsx}"], {
  eager: true,
  query: "?raw",
  import: "default",
});

function dependencies(file: string, files: Set<string>): string[] {
  const source = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest);
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      return [];
    }
    if (statement.importClause?.isTypeOnly) return [];
    const bindings = statement.importClause?.namedBindings;
    if (
      !statement.importClause?.name &&
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.every((element) => element.isTypeOnly)
    ) {
      return [];
    }
    const specifier = statement.moduleSpecifier.text;
    const target = specifier.startsWith("~/")
      ? `/app/${specifier.slice(2)}`
      : specifier.startsWith(".")
        ? new URL(specifier, `https://pay.test${file}`).pathname
        : null;
    if (!target) return [];
    return [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`].filter((path) =>
      files.has(path),
    );
  });
}

describe("feature dependencies", () => {
  const files = new Set(Object.keys(sources));
  const graph = new Map([...files].map((file) => [file, dependencies(file, files)]));

  it("keeps features independent of route modules and generated route types", () => {
    for (const file of files) {
      if (!file.includes("/features/")) continue;
      const source = ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest);
      for (const statement of source.statements) {
        if (
          !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          continue;
        }
        const specifier = statement.moduleSpecifier.text;
        const path = specifier.startsWith("~/")
          ? `/app/${specifier.slice(2)}`
          : new URL(specifier, `https://pay.test${file}`).pathname;
        expect(path, file).not.toContain("/routes/");
      }
    }
  });

  it("preserves frontend composition ownership", () => {
    for (const [file, imports] of graph) {
      expect(file).not.toContain("/_pages/");
      if (file.includes("/features/")) expect(file).not.toMatch(/\/(?:_?pages)\//);
      if (file.includes("/app/components/") || file.includes("/app/layouts/")) {
        expect(
          imports.filter((path) => path.includes("/features/")),
          file,
        ).toEqual([]);
      }
      if (file.includes("/features/") && file.includes("/components/")) {
        expect(
          imports.filter((path) => path.includes("/pages/")),
          file,
        ).toEqual([]);
      }
    }
  });

  it("keeps the runtime import graph acyclic", () => {
    function visit(file: string, stack: string[], visited: Set<string>) {
      expect(stack.includes(file), [...stack, file].join(" -> ")).toBe(false);
      if (visited.has(file)) return;
      for (const dependency of graph.get(file) ?? []) visit(dependency, [...stack, file], visited);
      visited.add(file);
    }
    const visited = new Set<string>();
    for (const file of files) visit(file, [], visited);
  });

  it("keeps shared UI and browser feature modules free of server dependencies", () => {
    const entries = [...files].filter(
      (file) =>
        !file.includes(".server.") &&
        (file.includes("/components/") ||
          file.includes("/features/") ||
          file.includes("/layouts/")),
    );
    function visit(file: string, visited: Set<string>) {
      expect(file, "browser module reaches server code").not.toContain(".server.");
      if (visited.has(file)) return;
      visited.add(file);
      for (const dependency of graph.get(file) ?? []) visit(dependency, visited);
    }
    for (const file of entries) visit(file, new Set());
  });
});
