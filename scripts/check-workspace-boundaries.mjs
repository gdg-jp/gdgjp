import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePattern = /\.[cm]?[jt]sx?$/;
const ignoredDirectories = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
]);

function inside(directory, file) {
  const path = relative(directory, file);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function json(file) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file}: expected an object`);
  }
  return value;
}

function submodules(root) {
  const file = resolve(root, ".gitmodules");
  return existsSync(file)
    ? [...readFileSync(file, "utf8").matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) =>
        resolve(root, match[1]),
      )
    : [];
}

function workspaces(root, excluded) {
  return ["apps", "packages"].flatMap((group) => {
    const directory = resolve(root, group);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      const manifest = resolve(path, "package.json");
      if (!entry.isDirectory() || !existsSync(manifest)) return [];
      const pkg = json(manifest);
      if (typeof pkg.name !== "string" || !pkg.name) {
        throw new Error(`${manifest}: expected a workspace name`);
      }
      return [{ directory: path, group, pkg, excluded: excluded.includes(path) }];
    });
  });
}

function sources(directory, excluded) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (excluded.includes(path) || entry.name.startsWith(".")) return [];
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : sources(path, excluded);
    }
    return sourcePattern.test(entry.name) &&
      entry.name !== "worker-configuration.d.ts" &&
      !entry.name.includes(".generated.")
      ? [path]
      : [];
  });
}

function compilerOptions(directory) {
  const file = resolve(directory, "tsconfig.json");
  if (!existsSync(file)) {
    return { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
  }
  const config = ts.readConfigFile(file, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory, undefined, file);
  const errors = parsed.errors.filter((error) => error.code !== 18003);
  if (errors.length) {
    throw new Error(
      `${file}: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("; ")}`,
    );
  }
  return parsed.options;
}

function importEdges(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  if (source.parseDiagnostics.length) {
    throw new Error(
      `${file}: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, "\n")}`,
    );
  }
  const edges = [];
  function visit(node) {
    let literal;
    let typeOnly = false;
    if (ts.isImportDeclaration(node)) {
      literal = node.moduleSpecifier;
      const clause = node.importClause;
      const named = clause?.namedBindings;
      typeOnly = Boolean(
        clause?.isTypeOnly ||
          (!clause?.name &&
            named &&
            ts.isNamedImports(named) &&
            named.elements.length > 0 &&
            named.elements.every((element) => element.isTypeOnly)),
      );
    } else if (ts.isExportDeclaration(node)) {
      literal = node.moduleSpecifier;
      typeOnly = Boolean(
        node.isTypeOnly ||
          (node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((element) => element.isTypeOnly)),
      );
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      literal = node.arguments[0];
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      literal = node.argument.literal;
      typeOnly = true;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      literal = node.moduleReference.expression;
      typeOnly = node.isTypeOnly;
    }
    if (literal && ts.isStringLiteralLike(literal)) {
      edges.push({
        specifier: literal.text,
        line: source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1,
        typeOnly,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return edges;
}

function applicationBoundaryError(workspace, file, targets, typeOnly) {
  const source = relative(workspace.directory, file).split(sep).join("/");
  if (
    workspace.group !== "apps" ||
    !source.startsWith("app/") ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(source) ||
    /(?:^|\/)(?:__tests__|tests|e2e)\//.test(source)
  )
    return undefined;
  const feature = source.startsWith("app/features/");
  const client =
    source.startsWith("app/components/") ||
    source.startsWith("app/layouts/") ||
    /^app\/features\/.+\/components\//.test(source) ||
    /\.client\.[cm]?[jt]sx?$/.test(source);
  for (const target of targets.filter((path) => inside(workspace.directory, path))) {
    const path = relative(workspace.directory, target).split(sep).join("/");
    const routePath = path.replace(/^\.react-router\/types\//, "");
    if (
      feature &&
      (routePath === "app/routes" ||
        routePath.startsWith("app/routes/") ||
        /^app\/routes\.[cm]?[jt]sx?$/.test(routePath) ||
        path.includes("/+types/"))
    )
      return "features cannot depend on route implementations or generated route types; move shared contracts into the owning feature";
    if (client && !typeOnly && /\.server(?:\.d)?(?:\.[cm]?[jt]sx?)?$/.test(path))
      return "runtime UI cannot import server implementations; load data in a route and pass it to the component, or use an explicit type-only contract";
  }
  return undefined;
}

function patternMatch(pattern, value) {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === value ? "" : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return value.startsWith(prefix) && value.endsWith(suffix) && value.length >= pattern.length - 1
    ? value.slice(prefix.length, value.length - suffix.length)
    : undefined;
}

function aliases(specifier, options, directory) {
  const matches = Object.entries(options.paths ?? {})
    .map(([pattern, targets]) => ({ pattern, targets, match: patternMatch(pattern, specifier) }))
    .filter(({ match }) => match !== undefined)
    .sort((a, b) => {
      const rank = (pattern) => [
        pattern.includes("*") ? 0 : 1,
        pattern.indexOf("*"),
        pattern.length,
      ];
      const left = rank(a.pattern);
      const right = rank(b.pattern);
      return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
    });
  const match = matches[0];
  const base = options.baseUrl ?? options.pathsBasePath ?? directory;
  return match
    ? match.targets.map((target) => resolve(base, target.replace("*", match.match)))
    : [];
}

function exported(value) {
  if (typeof value === "string") return value.startsWith("./");
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === null) return false;
      if (exported(item)) return true;
    }
    return false;
  }
  return value !== null && typeof value === "object" && Object.values(value).some(exported);
}

function publicEntry(pkg, entry) {
  const exports = pkg.exports;
  if (exports === undefined) return entry === ".";
  if (typeof exports === "string" || exports === null || Array.isArray(exports)) {
    return entry === "." && exported(exports);
  }
  if (typeof exports !== "object") throw new Error(`${pkg.name}: invalid exports map`);
  const keys = Object.keys(exports);
  if (keys.some((key) => key.startsWith(".")) && keys.some((key) => !key.startsWith("."))) {
    throw new Error(`${pkg.name}: mixed export subpaths and conditions`);
  }
  if (keys.every((key) => !key.startsWith("."))) return entry === "." && exported(exports);
  if (Object.hasOwn(exports, entry)) return exported(exports[entry]);
  const pattern = keys
    .filter((key) => key.includes("*") && patternMatch(key, entry) !== undefined)
    .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)[0];
  return pattern !== undefined && exported(exports[pattern]);
}

export function checkWorkspaceBoundaries(directory) {
  const root = realpathSync(resolve(directory));
  const excluded = submodules(root);
  const all = workspaces(root, excluded);
  if (!all.length) throw new Error(`${root}: no apps/* or packages/* workspace manifests found`);
  const byName = new Map();
  for (const workspace of all) {
    if (byName.has(workspace.pkg.name))
      throw new Error(`Duplicate workspace ${workspace.pkg.name}`);
    byName.set(workspace.pkg.name, workspace);
  }
  const scopes = new Set(
    [...byName.keys()].filter((name) => name.startsWith("@")).map((name) => name.split("/")[0]),
  );
  const owner = (file) => {
    const existing = all.find(({ directory }) => inside(directory, file));
    if (existing) return existing;
    const [group, name] = relative(root, file).split(sep);
    return (group === "apps" || group === "packages") && name
      ? { directory: resolve(root, group, name), group }
      : undefined;
  };
  const result = { files: 0, imports: 0, errors: [] };
  for (const workspace of all.filter(({ excluded }) => !excluded)) {
    const options = compilerOptions(workspace.directory);
    const cache = ts.createModuleResolutionCache(workspace.directory, (file) => file, options);
    const dependencies = {
      ...workspace.pkg.dependencies,
      ...workspace.pkg.devDependencies,
      ...workspace.pkg.peerDependencies,
      ...workspace.pkg.optionalDependencies,
    };
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && version.startsWith("workspace:") && !byName.has(name)) {
        result.errors.push(
          `${relative(root, workspace.directory)}/package.json: workspace ${name} is missing; initialize its submodule and install dependencies`,
        );
      }
    }
    for (const file of sources(workspace.directory, excluded)) {
      result.files += 1;
      for (const { specifier, line, typeOnly } of importEdges(file)) {
        result.imports += 1;
        const label = `${relative(root, file)}:${line}: ${JSON.stringify(specifier)}`;
        const clean = specifier.startsWith("#")
          ? specifier.split("?")[0]
          : specifier.split(/[?#]/)[0];
        const candidates =
          clean.startsWith(".") || isAbsolute(clean)
            ? [resolve(dirname(file), clean)]
            : aliases(clean, options, workspace.directory);
        if (!candidates.length && options.baseUrl) candidates.push(resolve(options.baseUrl, clean));
        const applicationError = applicationBoundaryError(workspace, file, candidates, typeOnly);
        if (applicationError) {
          result.errors.push(`${label}: ${applicationError}`);
          continue;
        }
        const foreign = candidates.map(owner).find((target) => target && target !== workspace);
        if (foreign) {
          result.errors.push(
            `${label}: crosses into ${relative(root, foreign.directory)} by path; use a declared shared package export, never another application's source`,
          );
          continue;
        }
        const name = clean.startsWith("@")
          ? clean.split("/").slice(0, 2).join("/")
          : clean.split("/")[0];
        const target = byName.get(name);
        if (target && target !== workspace) {
          if (target.group === "apps") {
            result.errors.push(
              `${label}: applications are service boundaries; use their API instead of importing ${name}`,
            );
          } else if (!Object.hasOwn(dependencies, name)) {
            result.errors.push(
              `${label}: declare ${name} in ${relative(root, workspace.directory)}/package.json`,
            );
          } else if (
            !publicEntry(target.pkg, clean === name ? "." : `.${clean.slice(name.length)}`)
          ) {
            result.errors.push(
              `${label}: ${name} does not export this entry; use its public exports`,
            );
          }
          continue;
        }
        if (!target && scopes.has(name.split("/")[0])) {
          result.errors.push(
            `${label}: workspace ${name} is missing; initialize its submodule or correct the package name`,
          );
          continue;
        }
        const resolved = ts.resolveModuleName(clean, file, options, ts.sys, cache).resolvedModule
          ?.resolvedFileName;
        const resolvedPath = resolved && (existsSync(resolved) ? realpathSync(resolved) : resolved);
        const resolvedApplicationError =
          resolvedPath && applicationBoundaryError(workspace, file, [resolvedPath], typeOnly);
        if (resolvedApplicationError) {
          result.errors.push(`${label}: ${resolvedApplicationError}`);
          continue;
        }
        const destination = resolvedPath && owner(resolvedPath);
        if (destination && destination !== workspace) {
          result.errors.push(
            `${label}: resolves into ${relative(root, destination.directory)} outside a declared public package import`,
          );
        }
      }
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--root")) {
      throw new Error("Usage: node scripts/check-workspace-boundaries.mjs [--root DIRECTORY]");
    }
    const result = checkWorkspaceBoundaries(args[1] ?? process.cwd());
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(
        `Workspace boundaries passed: ${result.files} files, ${result.imports} literal import edges`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
