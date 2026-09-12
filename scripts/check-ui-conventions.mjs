import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const rules = [
  {
    id: "semantic-color",
    message: "use semantic tokens instead of hard-coded black, white, or foreground borders",
    match: /\b(?:border-foreground|text-black|bg-white|text-white|bg-black)\b/,
    test: (source) =>
      /\b(?:border-foreground|text-black|bg-white|text-white|bg-black)\b/.test(source),
  },
  {
    id: "literal-color",
    message: "do not use literal or arbitrary class values",
    match: /(?:#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(|\[[^\]]+\])/i,
    test: (source) => /(?:#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(|\[[^\]]+\])/i.test(source),
    classNameOnly: true,
  },
  {
    id: "legacy-import",
    message: "import this capability from @gdgjp/ui instead of a legacy UI package",
    match:
      /(?:from\s*|import\s*\()["'](?:lucide-react|radix-ui|@radix-ui\/[^"']+|class-variance-authority|sonner|next-themes|tailwind-merge|clsx)["']/,
    test: (source) =>
      /(?:from\s*|import\s*\()["'](?:lucide-react|radix-ui|@radix-ui\/[^"']+|class-variance-authority|sonner|next-themes|tailwind-merge|clsx)["']/.test(
        source,
      ),
  },
  {
    id: "stack-align",
    message: "use Stack align instead of an items-* class",
    match: /<(?:\w+\.)?Stack\b[^>]*className\s*=\s*(?:\{\s*)?["'`][^"'`]*\bitems-[^"'`]*["'`]/,
    test: (source) =>
      /<(?:\w+\.)?Stack\b[^>]*className\s*=\s*(?:\{\s*)?["'`][^"'`]*\bitems-[^"'`]*["'`]/.test(
        source,
      ),
  },
  {
    id: "button-full-width",
    message: "use Button fullWidth instead of a w-full class",
    match: /<(?:\w+\.)?Button\b[^>]*className\s*=\s*(?:\{\s*)?["'`][^"'`]*\bw-full\b[^"'`]*["'`]/,
    test: (source) =>
      /<(?:\w+\.)?Button\b[^>]*className\s*=\s*(?:\{\s*)?["'`][^"'`]*\bw-full\b[^"'`]*["'`]/.test(
        source,
      ),
  },
  {
    id: "form-field-hide-label",
    message: "use FormField hideLabel instead of a manually hidden label node",
    match:
      /<(?:\w+\.)?FormField\b[^>]*label\s*=\s*\{\s*<span\s+className\s*=\s*["']gdg-sr-only["']/,
    test: (source) =>
      /<(?:\w+\.)?FormField\b[^>]*label\s*=\s*\{\s*<span\s+className\s*=\s*["']gdg-sr-only["']/.test(
        source,
      ),
  },
];

function parseArgs(args) {
  const apps = [];
  let staged = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--staged") staged = true;
    else if (args[index] === "--app") {
      const app = args[index + 1];
      if (!app) throw new Error("--app requires an app directory");
      apps.push(app);
      index += 1;
    } else if (args[index].startsWith("--")) throw new Error(`Unknown option: ${args[index]}`);
    else apps.push(args[index]);
  }
  return { apps, staged };
}

function packageUsesUi(directory) {
  const packagePath = join(root, directory, "package.json");
  if (!existsSync(packagePath)) return false;
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  return pkg.dependencies?.["@gdgjp/ui"] === "workspace:*";
}

function defaultApps() {
  return readdirSync(root).filter((directory) => {
    const path = join(root, directory);
    return statSync(path).isDirectory() && packageUsesUi(directory);
  });
}

function walk(directory) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...walk(path));
    else if (/\.(?:tsx|css)$/.test(entry.name)) paths.push(path);
  }
  return paths;
}

function stagedPaths(apps) {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "-z", "--no-renames"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Could not read the staged file list");
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((path) => apps.some((app) => path.startsWith(`${app}/app/`)))
    .filter((path) => /\.(?:tsx|css)$/.test(path))
    .filter((path) => existsSync(join(root, path)))
    .map((path) => join(root, path));
}

function classNameStrings(source) {
  return [...source.matchAll(/className\s*=\s*(?:\{\s*)?(["'`])([\s\S]*?)\1/g)].map(
    (match) => match[2],
  );
}

function violations(source, rule) {
  if (!rule.classNameOnly) {
    const flags = rule.match.flags.includes("g") ? rule.match.flags : `${rule.match.flags}g`;
    return [...source.matchAll(new RegExp(rule.match.source, flags))].map(
      (match) => source.slice(0, match.index).split("\n").length,
    );
  }
  const className = /className\s*=\s*(?:\{\s*)?(["'`])([\s\S]*?)\1/g;
  const lines = [];
  for (const match of source.matchAll(className)) {
    if (rule.test(match[2])) lines.push(source.slice(0, match.index).split("\n").length);
  }
  return lines;
}

function hasAllowPragma(source, line, ruleId) {
  const previous = source.split("\n")[line - 2] ?? "";
  return new RegExp(`gdg-ui-allow:\\s*${ruleId}\\s+—\\s+\\S+`).test(previous);
}

function checkApp(app, files) {
  const errors = [];
  const allowances = [];
  const appCss = join(root, app, "app", "app.css");
  if (!existsSync(appCss)) {
    errors.push(`${app}/app/app.css: missing stylesheet`);
  } else {
    const first = readFileSync(appCss, "utf8")
      .split("\n")
      .find((line) => line.trim() && !line.trim().startsWith("/*") && !line.trim().startsWith("*"));
    if (first?.trim() !== "@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;") {
      errors.push(`${app}/app/app.css: layer-order must be the first non-comment line`);
    }
  }
  if (existsSync(join(root, app, "app", "components", "ui"))) {
    errors.push(`${app}/app/components/ui: legacy component directory must not exist`);
  }
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const rule of rules) {
      const inspected = rule.classNameOnly ? classNameStrings(source).join("\n") : source;
      if (!rule.test(inspected)) continue;
      for (const line of violations(source, rule)) {
        if (hasAllowPragma(source, line, rule.id)) {
          allowances.push(`${relative(root, file)}:${line} ${rule.id}`);
        } else {
          errors.push(`${relative(root, file)}:${line}: ${rule.id}: ${rule.message}`);
        }
      }
    }
  }
  return { errors, allowances };
}

try {
  const { apps: requested, staged } = parseArgs(process.argv.slice(2));
  const apps = requested.length > 0 ? requested : defaultApps();
  const errors = [];
  const allowances = [];
  for (const app of apps) {
    if (!packageUsesUi(app)) {
      errors.push(`${app}: does not declare @gdgjp/ui as a workspace dependency`);
      continue;
    }
    const files = staged ? stagedPaths([app]) : walk(join(root, app, "app"));
    const result = checkApp(app, files);
    errors.push(...result.errors);
    allowances.push(...result.allowances);
  }
  for (const allowance of allowances) console.log(`ui-convention allowance: ${allowance}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ui-convention error: ${error}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`ui-convention error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
