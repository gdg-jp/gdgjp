import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const app = resolve(testDirectory, "../../app");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(path) && !/\.test\./.test(path)
        ? [path]
        : [];
  });
}

function imports(file: string) {
  // Only parse declarations: scanning chart/form bodies adds work unrelated to
  // dependency directions, especially when all workspace tests run together.
  const declarations = [...readFileSync(file, "utf8").matchAll(/^import\b[^;]*;/gm)]
    .map((match) => match[0])
    .join("\n");
  const source = ts.createSourceFile(file, declarations, ts.ScriptTarget.Latest, true);
  return source.statements.filter(ts.isImportDeclaration).map((statement) => {
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const target = specifier.startsWith("~/")
      ? resolve(app, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : specifier;
    const clause = statement.importClause;
    const typeOnly =
      clause?.isTypeOnly ||
      (clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.every((element) => element.isTypeOnly));
    return { target, typeOnly };
  });
}

describe("TinyURL architecture boundaries", () => {
  it("keeps domain models and widgets independent of route implementations and generated route types", () => {
    const violations = sources(resolve(app, "features")).flatMap((file) =>
      imports(file)
        .filter(({ target }) => target.startsWith(resolve(app, "routes")))
        .map(({ target }) => `${relative(app, file)} -> ${relative(app, target)}`),
    );
    expect(violations).toEqual([]);
    const pageDirectories = readdirSync(resolve(app, "features"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(resolve(app, "features", entry.name, "pages")))
      .map((entry) => entry.name);
    expect(pageDirectories).toEqual([]);
  });

  it("keeps primitives and utilities independent of domains, layouts, and routes", () => {
    const violations = ["components", "lib"].flatMap((layer) =>
      sources(resolve(app, layer)).flatMap((file) =>
        imports(file)
          .filter(({ target }) =>
            ["features", "layouts", "routes"].some((name) => target.startsWith(resolve(app, name))),
          )
          .map(({ target }) => `${relative(app, file)} -> ${relative(app, target)}`),
      ),
    );
    expect(violations).toEqual([]);
    expect(readdirSync(resolve(app, "lib")).sort()).toEqual(["use-media-query.ts"]);
    expect(existsSync(resolve(app, "lib/db.ts"))).toBe(false);
  });

  it("allows browser widgets only type imports from server modules", () => {
    const violations = sources(resolve(app, "features"))
      .filter((file) => /\/components\//.test(file))
      .flatMap((file) =>
        imports(file)
          .filter(({ target, typeOnly }) => /\.server(?:\.|$)/.test(target) && !typeOnly)
          .map(({ target }) => `${relative(app, file)} -> ${relative(app, target)}`),
      );
    expect(violations).toEqual([]);
  });

  it("preserves every public URL while grouping route adapters by domain", () => {
    const config = readFileSync(resolve(app, "routes.ts"), "utf8");
    const urls = [...config.matchAll(/\broute\(\s*"([^"]+)"/g)].map((match) => match[1]);
    const expected = JSON.parse(readFileSync(resolve(testDirectory, "route-urls.json"), "utf8"));
    expect(urls).toEqual(expected);
    const pageDirectories = readdirSync(resolve(app, "routes"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(resolve(app, "routes", entry.name, "_pages")))
      .map((entry) => entry.name);
    expect(pageDirectories).toEqual([]);
    for (const [, path] of config.matchAll(/"(routes\/[^\"]+\.tsx?)"/g)) {
      expect(existsSync(resolve(app, path)), path).toBe(true);
    }
  });
});
