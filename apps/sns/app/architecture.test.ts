/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const app = dirname(fileURLToPath(import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(path) && !path.endsWith(".test.ts")
        ? [path]
        : [];
  });
}

describe("SNS feature boundaries", () => {
  it("keeps shared primitives and layout shells in their designated directories", () => {
    expect(readdirSync(join(app, "lib")).sort()).toEqual([
      "crypto.server.ts",
      "utils.test.ts",
      "utils.ts",
    ]);
    expect(existsSync(join(app, "components")) ? readdirSync(join(app, "components")) : []).toEqual(
      ["blurhash-placeholder.tsx"],
    );
    expect(readdirSync(join(app, "layouts"))).toEqual(["app-shell.tsx"]);
  });

  it("keeps feature implementation independent of routes and Worker composition", () => {
    for (const domain of readdirSync(join(app, "features"))) {
      expect(existsSync(join(app, "features", domain, "pages"))).toBe(false);
    }
    for (const file of sources(join(app, "features"))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
          continue;
        const target = statement.moduleSpecifier.text;
        expect(target, file).not.toMatch(/(?:^|\/)routes(?:\/|$)|(?:^|\/)workers(?:\/|$)/);
        if (file.includes("/components/") && !statement.importClause?.isTypeOnly) {
          expect(target, file).not.toMatch(/\.server$/);
        }
      }
    }
  });

  it("keeps domain-free components independent of features and pages free of private widgets", () => {
    for (const file of sources(join(app, "components"))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          expect(statement.moduleSpecifier.text, file).not.toMatch(
            /(?:^|\/)(?:features|layouts|routes|workers)(?:\/|$)/,
          );
        }
      }
    }
    for (const file of sources(join(app, "routes")).filter(
      (path) =>
        path.endsWith(".tsx") &&
        /export default/.test(readFileSync(path, "utf8")) &&
        /export default/.test(readFileSync(path, "utf8")),
    )) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const components = source.statements.filter(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) && /^[A-Z]/.test(statement.name?.text ?? ""),
      );
      expect(components, file).toHaveLength(1);
      expect(
        components[0]?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
        file,
      ).toBe(true);
    }
  });

  it("keeps SQL in owned features rather than HTTP routes", () => {
    for (const domain of ["posts", "google-photos", "settings"]) {
      expect(existsSync(join(app, "routes", domain, "_pages"))).toBe(false);
    }
    for (const file of sources(join(app, "routes"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\.prepare\s*\(/);
    }
  });
});
