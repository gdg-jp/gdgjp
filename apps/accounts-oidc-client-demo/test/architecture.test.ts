import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps components/platform independent and the runtime graph acyclic", () => {
  const root = resolve(import.meta.dirname, "../src");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".ts"),
  );
  const graph = new Map<string, string[]>();
  const allowed: Record<string, string[]> = {
    "index.ts": ["auth", "pages"],
    auth: ["auth", "pages", "platform"],
    components: [],
    widgets: ["components"],
    pages: ["components", "widgets", "platform"],
    platform: [],
  };
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(resolve(root, file), "utf8"),
      ts.ScriptTarget.Latest,
    );
    const imports: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue;
      const clause = statement.importClause;
      if (
        clause?.isTypeOnly ||
        (clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          !clause.name &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((binding) => binding.isTypeOnly))
      )
        continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const target = `${relative(root, resolve(root, dirname(file), specifier))}.ts`;
      expect(files, `${file} imports a missing module`).toContain(target);
      expect(
        allowed[file === "index.ts" ? file : file.split("/")[0]],
        `${file} imports ${target}`,
      ).toContain(target.split("/")[0]);
      imports.push(target);
    }
    graph.set(file, imports);
  }
  function visit(file: string, ancestors: string[]): void {
    expect(ancestors, `runtime cycle: ${[...ancestors, file].join(" -> ")}`).not.toContain(file);
    for (const target of graph.get(file) ?? []) visit(target, [...ancestors, file]);
  }
  for (const file of files) visit(file, []);
});
