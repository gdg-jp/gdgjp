import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = process.cwd();
const sourceExtensionPattern = /\.(?:ts|tsx|js|jsx|css)$/;
const scriptSourceExtensionPattern = /\.(?:ts|tsx|js|jsx)$/;
const legacyImportPattern =
  /\b(?:from|import|require)\s*(?:\(\s*)?["'](lucide-react|radix-ui|@radix-ui\/[^"']+|class-variance-authority|sonner|next-themes|tailwind-merge|clsx)["']/g;
const privateUiImportPattern =
  /\b(?:from|import|require)\s*(?:\(\s*)?["']@gdgjp\/design-system\/src(?:\/[^"']*)?["']/g;
const semanticColorPattern =
  /\b(?:border-foreground|border-black|border-white|text-black|text-white|bg-black|bg-white)\b/g;
const literalColorPattern = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color)\s*\(/gi;
const arbitraryColorClassPattern =
  /\b(?:bg|text|border|ring|outline|shadow|from|via|to|decoration|accent|caret|fill|stroke)-\[([^\]]*)\]/gi;
const namedCssColorPattern =
  /\b(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blue|brown|coral|crimson|cyan|fuchsia|gold|gray|green|indigo|ivory|khaki|lavender|lime|magenta|maroon|navy|olive|orange|orchid|pink|plum|purple|red|salmon|silver|tan|teal|tomato|turquoise|violet|white|yellow)\b/i;
const knownRuleIds = new Set([
  "legacy-import",
  "private-ui-import",
  "semantic-color",
  "literal-color",
  "stack-align",
  "button-full-width",
  "form-field-hide-label",
]);
const placeholderRationales = new Set([
  "app-specific-layout-or-token",
  "n/a",
  "na",
  "none",
  "placeholder",
  "reason",
  "tbd",
  "todo",
]);
const expectedLayerDeclaration =
  "@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;";
const sharedStyleImports = [
  '@import "tailwindcss";',
  '@import "@gdgjp/design-system/tailwind.css";',
  '@import "@gdgjp/design-system/components.css";',
  '@import "@gdgjp/design-system/fonts.css";',
];
const baselineRelativePath = (app) => `${app}/tests/architecture/ui-conventions-baseline.json`;

export const RULE_IDS = [...knownRuleIds];

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function normalizeFingerprint(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function finding(ruleId, source, index, fingerprint) {
  return {
    ruleId,
    line: lineNumber(source, index),
    fingerprint: normalizeFingerprint(fingerprint),
  };
}

function scanBalancedValue(source, start, open = "{", close = "}") {
  if (source[start] !== open) return null;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return { end: index + 1, value: source.slice(start, index + 1) };
    }
  }
  return null;
}

function scanAttributeValue(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  const first = source[index];
  if (first === '"' || first === "'" || first === "`") {
    let escaped = false;
    for (index += 1; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === first) {
        return { end: index + 1, value: source.slice(start, index + 1) };
      }
    }
    return null;
  }
  if (first === "{") return scanBalancedValue(source, index);
  const endMatch = source.slice(index).match(/[\s>]/);
  const end = endMatch ? index + endMatch.index : source.length;
  return { end, value: source.slice(start, end) };
}

function attributeValues(source, names) {
  const namePattern = names.join("|");
  const attributePattern = new RegExp(`\\b(${namePattern})\\s*=\\s*`, "g");
  const values = [];
  for (const match of source.matchAll(attributePattern)) {
    const start = match.index + match[0].length;
    const value = scanAttributeValue(source, start);
    if (value) values.push({ name: match[1], start, value: value.value });
  }
  return values;
}

function openingTags(source) {
  const tags = [];
  for (let cursor = 0; cursor < source.length; ) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    const match = source.slice(start).match(/^<([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)\b/);
    if (!match) {
      cursor = start + 1;
      continue;
    }
    let quote = null;
    let braceDepth = 0;
    let escaped = false;
    let end = -1;
    for (let index = start + match[0].length; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") braceDepth += 1;
      else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (character === ">" && braceDepth === 0) {
        end = index + 1;
        break;
      }
    }
    if (end < 0) break;
    tags.push({ name: match[1], start, source: source.slice(start, end) });
    cursor = end;
  }
  return tags;
}

function colorLiteralMatches(value) {
  const arbitraryMatches = [...value.matchAll(arbitraryColorClassPattern)];
  const matches = [...value.matchAll(literalColorPattern)]
    .filter(
      (match) =>
        !arbitraryMatches.some(
          (arbitrary) =>
            match.index >= arbitrary.index && match.index < arbitrary.index + arbitrary[0].length,
        ),
    )
    .map((match) => ({ index: match.index, fingerprint: match[0] }));
  for (const match of arbitraryMatches) {
    const arbitraryValue = match[1];
    literalColorPattern.lastIndex = 0;
    namedCssColorPattern.lastIndex = 0;
    const hasLiteral =
      literalColorPattern.test(arbitraryValue) ||
      namedCssColorPattern.test(arbitraryValue.replaceAll("_", " "));
    literalColorPattern.lastIndex = 0;
    namedCssColorPattern.lastIndex = 0;
    if (hasLiteral) matches.push({ index: match.index, fingerprint: match[0] });
  }
  return matches;
}

function hasDynamicColorPolicy(source, index) {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = source.indexOf("\n", index);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  return line.includes("design-token-policy: allow-dynamic-color");
}

function cssDeclarationValues(source) {
  const declarations = [];
  const declarationStartPattern = /(?:^|[;{])\s*[-\w]+\s*:\s*/g;
  for (const match of source.matchAll(declarationStartPattern)) {
    const start = match.index + match[0].length;
    let end = start;
    let parentheses = 0;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (character === "(") parentheses += 1;
      else if (character === ")") parentheses = Math.max(0, parentheses - 1);
      else if ((character === ";" || character === "}") && parentheses === 0) break;
    }
    declarations.push({ start, value: source.slice(start, end) });
  }
  return declarations;
}

export function findViolations(source, { extension = ".tsx" } = {}) {
  const findings = [];
  const addMatches = (ruleId, matches, offset = 0) => {
    for (const match of matches) {
      findings.push(finding(ruleId, source, offset + match.index, match.fingerprint));
    }
  };

  if (scriptSourceExtensionPattern.test(extension)) {
    addMatches(
      "legacy-import",
      [...source.matchAll(legacyImportPattern)].map((match) => ({
        index: match.index,
        fingerprint: match[1],
      })),
    );
    addMatches(
      "private-ui-import",
      [...source.matchAll(privateUiImportPattern)].map((match) => ({
        index: match.index,
        fingerprint:
          match[0].match(/@gdgjp\/design-system\/src[^"']*/)?.[0] ?? "@gdgjp/design-system/src",
      })),
    );

    const attributes = attributeValues(
      source,
      extension === ".tsx" || extension === ".jsx" ? ["className", "style"] : ["className"],
    );
    for (const attribute of attributes) {
      addMatches(
        "semantic-color",
        [...attribute.value.matchAll(semanticColorPattern)].map((match) => ({
          index: match.index,
          fingerprint: match[0],
        })),
        attribute.start,
      );
      addMatches(
        "literal-color",
        colorLiteralMatches(attribute.value).filter(
          (match) => !hasDynamicColorPolicy(source, attribute.start + match.index),
        ),
        attribute.start,
      );
    }

    for (const tag of openingTags(source)) {
      const attributes = attributeValues(tag.source, ["className", "label"]);
      const className = attributes.find(({ name }) => name === "className");
      const classValue = className?.value ?? "";
      if (tag.name === "Stack" || tag.name.endsWith(".Stack")) {
        const match = classValue.match(/\bitems-(?:start|end|center|baseline|stretch)\b/);
        if (match && className) {
          findings.push(finding("stack-align", source, tag.start + className.start, match[0]));
        }
      }
      if (tag.name === "Button" || tag.name.endsWith(".Button")) {
        const match = classValue.match(/\bw-full\b/);
        if (match && className) {
          findings.push(
            finding("button-full-width", source, tag.start + className.start, match[0]),
          );
        }
      }
      if (tag.name === "FormField" || tag.name.endsWith(".FormField")) {
        const label = attributes.find(({ name }) => name === "label");
        if (label && /\bgdg-sr-only\b/.test(label.value)) {
          findings.push(
            finding("form-field-hide-label", source, tag.start + label.start, "gdg-sr-only"),
          );
        }
      }
    }
  } else if (extension === ".css") {
    for (const declaration of cssDeclarationValues(source)) {
      addMatches("literal-color", colorLiteralMatches(declaration.value), declaration.start);
    }
  }

  return findings.sort(
    (left, right) => left.line - right.line || left.ruleId.localeCompare(right.ruleId),
  );
}

function parseAllowanceLine(line, lineNumberValue) {
  const markerIndex = line.indexOf("gdg-ui-allow:");
  if (markerIndex < 0) return null;
  const raw = line
    .slice(markerIndex + "gdg-ui-allow:".length)
    .replace(/\s*\*\/\s*$/, "")
    .trim();
  const match = raw.match(/^([a-z0-9-]+)(?:\s+—\s+(.+))?$/u);
  if (!match) {
    return { line: lineNumberValue, error: "must use '<rule-id> — <specific rationale>'" };
  }
  const ruleId = match[1];
  const rationale = match[2]?.trim() ?? "";
  if (!knownRuleIds.has(ruleId)) {
    return { line: lineNumberValue, error: `unknown rule '${ruleId}'` };
  }
  if (
    rationale.length < 8 ||
    placeholderRationales.has(rationale.toLowerCase()) ||
    /^(?:todo|tbd|n\/?a|reason|placeholder)\b/i.test(rationale)
  ) {
    return { line: lineNumberValue, error: "rationale must be specific" };
  }
  return { line: lineNumberValue, ruleId, rationale };
}

function allowances(source) {
  const parsed = [];
  for (const [index, line] of source.split("\n").entries()) {
    if (!line.includes("gdg-ui-allow:")) continue;
    parsed.push(parseAllowanceLine(line, index + 1));
  }
  return parsed;
}

function applyAllowances(source, findings) {
  const errors = [];
  const allowed = new Set();
  const usedFindings = new Set();
  for (const allowance of allowances(source)) {
    if (allowance.error) {
      errors.push(`line ${allowance.line}: ${allowance.error}`);
      continue;
    }
    const index = findings.findIndex(
      (candidate, candidateIndex) =>
        !usedFindings.has(candidateIndex) &&
        candidate.ruleId === allowance.ruleId &&
        candidate.line === allowance.line + 1,
    );
    if (index < 0) {
      errors.push(`line ${allowance.line}: stale allowance for ${allowance.ruleId}`);
      continue;
    }
    usedFindings.add(index);
    allowed.add(index);
  }
  return { errors, allowed };
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git command failed").trim();
    throw new Error(detail || "git command failed");
  }
  return result.stdout;
}

function readIndexFile(path, cwd) {
  const result = spawnSync("git", ["show", `:${path}`], { cwd, encoding: "utf8" });
  if (result.status === 0) return { exists: true, source: result.stdout };
  return { exists: false, source: "" };
}

function indexPaths(prefix, cwd) {
  return runGit(["ls-files", "--cached", "-z", "--", prefix], cwd).split("\0").filter(Boolean);
}

export function stagedFilePaths(apps, cwd = repositoryRoot) {
  return runGit(["diff", "--cached", "--name-only", "-z", "--no-renames"], cwd)
    .split("\0")
    .filter(Boolean)
    .filter((path) =>
      apps.some(
        (app) =>
          path === `${app}/package.json` ||
          path === baselineRelativePath(app) ||
          path.startsWith(`${app}/app/`),
      ),
    );
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (sourceExtensionPattern.test(entry.name)) paths.push(path);
  }
  return paths;
}

function parseManifest(source, path) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

export function packageUsesUi(directory, cwd = repositoryRoot) {
  const path = `${directory}/package.json`;
  const file = existsSync(join(cwd, path))
    ? { exists: true, source: readFileSync(join(cwd, path), "utf8") }
    : { exists: false, source: "" };
  if (!file.exists) return false;
  const packageJson = parseManifest(file.source, path);
  return packageJson.dependencies?.["@gdgjp/design-system"] === "workspace:*";
}

function defaultApps(cwd) {
  const appsDir = join(cwd, "apps");
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir)
    .filter((directory) => {
      const path = join(appsDir, directory);
      return statSync(path).isDirectory() && packageUsesUi(`apps/${directory}`, cwd);
    })
    .map((directory) => `apps/${directory}`);
}

function readBaseline(app, mode, cwd) {
  const path = baselineRelativePath(app);
  const file =
    mode === "staged"
      ? readIndexFile(path, cwd)
      : existsSync(join(cwd, path))
        ? { exists: true, source: readFileSync(join(cwd, path), "utf8") }
        : { exists: false, source: "" };
  if (!file.exists) return { entries: [], errors: [] };
  let document;
  try {
    document = JSON.parse(file.source);
  } catch (error) {
    return {
      entries: [],
      errors: [`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`],
    };
  }
  if (document?.version !== 1 || !Array.isArray(document.entries)) {
    return { entries: [], errors: [`${path}: expected { version: 1, entries: [] }`] };
  }
  const entries = [];
  const seen = new Set();
  const errors = [];
  for (const [index, entry] of document.entries.entries()) {
    const prefix = `${path}: entries[${index}]`;
    if (
      !entry ||
      typeof entry.ruleId !== "string" ||
      typeof entry.path !== "string" ||
      typeof entry.fingerprint !== "string" ||
      !Number.isInteger(entry.count) ||
      entry.count < 1
    ) {
      errors.push(`${prefix}: requires ruleId, path, fingerprint, and positive integer count`);
      continue;
    }
    if (!knownRuleIds.has(entry.ruleId)) errors.push(`${prefix}: unknown rule '${entry.ruleId}'`);
    if (entry.path.includes("..") || !entry.path.startsWith(`${app}/app/`)) {
      errors.push(`${prefix}: path must be a repository-relative ${app}/app path`);
    }
    if ([`${app}/app/root.tsx`, `${app}/app/app.css`, `${app}/package.json`].includes(entry.path)) {
      errors.push(`${prefix}: foundation-owned path cannot be in the migration baseline`);
    }
    const normalized = {
      ruleId: entry.ruleId,
      path: entry.path,
      fingerprint: normalizeFingerprint(entry.fingerprint),
      count: entry.count,
    };
    const key = `${normalized.path}\0${normalized.ruleId}\0${normalized.fingerprint}`;
    if (seen.has(key)) errors.push(`${prefix}: duplicate violation identity`);
    seen.add(key);
    entries.push(normalized);
  }
  return { entries, errors };
}

function baselineKey(path, violation) {
  return `${path}\0${violation.ruleId}\0${violation.fingerprint}`;
}

function applyBaseline(snapshots, baseline) {
  const errors = [];
  const warnings = [];
  const counts = new Map();
  for (const { path, findings } of snapshots) {
    for (const violation of findings) {
      const key = baselineKey(path, violation);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const entries = new Map(baseline.entries.map((entry) => [baselineKey(entry.path, entry), entry]));
  for (const [key, count] of counts) {
    const entry = entries.get(key);
    if (!entry) {
      const [path, ruleId, fingerprint] = key.split("\0");
      errors.push(`${path}: ${ruleId} '${fingerprint}' is not in the migration baseline`);
    } else if (count > entry.count) {
      errors.push(
        `${entry.path}: ${entry.ruleId} '${entry.fingerprint}' increased from ${entry.count} to ${count}`,
      );
    }
  }
  const inspectedPaths = new Set(snapshots.map(({ path }) => path));
  for (const entry of baseline.entries) {
    if (!inspectedPaths.has(entry.path)) continue;
    const count = counts.get(baselineKey(entry.path, entry)) ?? 0;
    if (count < entry.count) {
      warnings.push(
        `${entry.path}: baseline entry ${entry.ruleId}/${entry.fingerprint} shrank from ${entry.count} to ${count}; update the baseline`,
      );
    }
  }
  return { errors, warnings };
}

function cssSelectorAllowed(selector) {
  const normalized = selector.trim().replace(/^\.dark\s+/, "");
  return /^(?:\.remote-cursor(?:-label)?|\.md-editor(?:-dark)?(?:\b|[-_])|\.md-editor-preview\b|\.reaction-active(?:\b|\s)|article\[data-small-text=)/.test(
    normalized,
  );
}

function checkStylesheet(source, path, app) {
  const errors = [];
  const first = source.split("\n").find((line) => {
    const trimmed = line.trim();
    return (
      trimmed && !trimmed.startsWith("/*") && !trimmed.startsWith("*") && !trimmed.startsWith("*/")
    );
  });
  if (first?.trim() !== expectedLayerDeclaration) {
    errors.push(`${path}: layer-order must be the first non-comment line`);
  }
  for (const importPath of sharedStyleImports) {
    const count = source.split(importPath).length - 1;
    if (count !== 1) errors.push(`${path}: expected exactly one ${importPath} (found ${count})`);
  }
  if (source.includes("@theme")) errors.push(`${path}: app.css must not define an @theme block`);
  const imports = [...source.matchAll(/@import\s+[^;]+;/g)].map((match) => match[0]);
  if (imports.join("\n") !== sharedStyleImports.join("\n")) {
    errors.push(`${path}: shared CSS imports must appear once in the documented order`);
  }
  if (basename(app) !== "wiki") return errors;
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/(?:^|})\s*([^{}]+?)\s*\{/g)) {
    const selectorText = match[1].replace(/(?:^|;)\s*@(?:layer|import|source)[^;]*;/g, "").trim();
    if (!selectorText || selectorText.startsWith("@")) continue;
    for (const selector of selectorText.split(",")) {
      if (!cssSelectorAllowed(selector)) {
        errors.push(
          `${path}:${lineNumber(source, match.index)}: selector is outside the app-local CSS bridge`,
        );
      }
    }
  }
  return errors;
}

function checkRoot(source, path) {
  const errors = [];
  const providerCount = (source.match(/<ThemeProvider\b/g) ?? []).length;
  const toasterCount = (source.match(/<Toaster\b/g) ?? []).length;
  if (!source.includes("export function Layout")) errors.push(`${path}: shared Layout is missing`);
  if (providerCount !== 1)
    errors.push(`${path}: expected one ThemeProvider JSX element (found ${providerCount})`);
  if (toasterCount !== 1)
    errors.push(`${path}: expected one Toaster JSX element (found ${toasterCount})`);
  if ((source.match(/storageKey=\"gdg-apps-theme\"/g) ?? []).length !== 1) {
    errors.push(`${path}: storageKey=\"gdg-apps-theme\" must be declared once`);
  }
  if ((source.match(/defaultTheme=\"system\"/g) ?? []).length !== 1) {
    errors.push(`${path}: defaultTheme=\"system\" must be declared once`);
  }
  if ((source.match(/<html\b/g) ?? []).length !== 1)
    errors.push(`${path}: document must contain one <html>`);
  if (source.includes("themeInitScript") || source.includes("theme-init.js")) {
    errors.push(`${path}: legacy theme bootstrap must not be used`);
  }
  const errorBoundaryStart = source.indexOf("export function ErrorBoundary");
  if (errorBoundaryStart >= 0 && source.slice(errorBoundaryStart).includes("<html")) {
    errors.push(`${path}: ErrorBoundary must render inside the shared Layout`);
  }
  return errors;
}

function readWorkingFile(path, cwd) {
  const fullPath = join(cwd, path);
  return existsSync(fullPath)
    ? { exists: true, source: readFileSync(fullPath, "utf8") }
    : { exists: false, source: "" };
}

function checkApp(app, { mode, cwd = repositoryRoot } = {}) {
  const errors = [];
  const warnings = [];
  const staged = mode === "staged";
  const changedPaths = staged ? stagedFilePaths([app], cwd) : [];
  const foundationRequested =
    !staged ||
    changedPaths.some(
      (path) =>
        path === `${app}/package.json` ||
        path === baselineRelativePath(app) ||
        path.startsWith(`${app}/app/`),
    );
  if (!foundationRequested) return { errors, warnings };

  const read = (path) => (staged ? readIndexFile(path, cwd) : readWorkingFile(path, cwd));
  const manifestPath = `${app}/package.json`;
  const manifest = read(manifestPath);
  if (!manifest.exists) {
    errors.push(
      `${manifestPath}: missing package manifest in ${staged ? "Git index" : "working tree"}`,
    );
  } else {
    try {
      const packageJson = parseManifest(manifest.source, manifestPath);
      if (packageJson.dependencies?.["@gdgjp/design-system"] !== "workspace:*") {
        errors.push(
          `${manifestPath}: does not declare @gdgjp/design-system as a workspace dependency`,
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const cssPath = `${app}/app/app.css`;
  const css = read(cssPath);
  if (!css.exists) errors.push(`${cssPath}: missing stylesheet`);
  else errors.push(...checkStylesheet(css.source, cssPath, app));

  const rootPath = `${app}/app/root.tsx`;
  const rootFile = read(rootPath);
  if (!rootFile.exists) errors.push(`${rootPath}: missing root module`);
  else if (basename(app) === "wiki") errors.push(...checkRoot(rootFile.source, rootPath));

  const legacyPrefix = `${app}/app/components/ui/`;
  const legacyExists = staged
    ? indexPaths(legacyPrefix, cwd).length > 0
    : existsSync(join(cwd, app, "app", "components", "ui"));
  if (legacyExists)
    errors.push(`${app}/app/components/ui: legacy component directory must not exist`);

  const selectedPaths = staged
    ? changedPaths.filter((path) => sourceExtensionPattern.test(path))
    : walk(join(cwd, app, "app")).map((path) => relative(cwd, path));
  const sourcePaths = new Set(selectedPaths);
  if (foundationRequested) {
    sourcePaths.add(rootPath);
    sourcePaths.add(cssPath);
  }
  const snapshots = [];
  for (const path of [...sourcePaths].sort()) {
    const file = read(path);
    if (!file.exists) continue;
    const fileFindings = findViolations(file.source, { extension: extname(path) });
    const allowanceResult = applyAllowances(file.source, fileFindings);
    for (const error of allowanceResult.errors) errors.push(`${path}: ${error}`);
    const unallowed = fileFindings.filter((_, index) => !allowanceResult.allowed.has(index));
    snapshots.push({ path, findings: unallowed });
  }

  const baseline = readBaseline(app, mode, cwd);
  errors.push(...baseline.errors);
  const baselineResult = applyBaseline(snapshots, baseline);
  errors.push(...baselineResult.errors);
  warnings.push(...baselineResult.warnings);
  return { errors, warnings, snapshots };
}

export function parseArgs(args) {
  const apps = [];
  let staged = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--staged") staged = true;
    else if (argument === "--app") {
      const app = args[index + 1];
      if (!app || app.startsWith("--")) throw new Error("--app requires an app directory");
      apps.push(app);
      index += 1;
    } else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else apps.push(argument);
  }
  return { apps, staged };
}

export function run(args = process.argv.slice(2), cwd = repositoryRoot) {
  const { apps: requested, staged } = parseArgs(args);
  const apps = requested.length > 0 ? requested : defaultApps(cwd);
  const errors = [];
  const warnings = [];
  for (const app of apps) {
    const result = checkApp(app, { mode: staged ? "staged" : "full", cwd });
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  for (const warning of warnings) console.warn(`ui-convention warning: ${warning}`);
  for (const error of errors) console.error(`ui-convention error: ${error}`);
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`ui-convention error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
