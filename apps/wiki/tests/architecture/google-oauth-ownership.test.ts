import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps OAuth exports owned by the OAuth module instead of the Drive file API", () => {
  const drivePath = fileURLToPath(
    new URL("../../app/features/google/drive.server.ts", import.meta.url),
  );
  const oauthPath = fileURLToPath(
    new URL("../../app/features/google/drive-oauth.server.ts", import.meta.url),
  );
  const program = ts.createProgram([drivePath, oauthPath], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    types: [],
  });
  const checker = program.getTypeChecker();
  const drive = program.getSourceFile(drivePath);
  if (!drive) throw new Error("Drive file API did not load");
  const module = checker.getSymbolAtLocation(drive);
  if (!module) throw new Error("Drive file API is not a module");
  const exports = checker.getExportsOfModule(module);

  expect(exports.map((symbol) => symbol.name)).toEqual(
    expect.arrayContaining(["exportFileAsPdf", "getGoogleDocumentWithTabs", "getDriveFileName"]),
  );
  expect(
    exports
      .filter((symbol) => {
        const definition =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return definition.declarations?.some(
          (declaration) => declaration.getSourceFile().fileName === oauthPath,
        );
      })
      .map((symbol) => symbol.name),
  ).toEqual([]);
});
