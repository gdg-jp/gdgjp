#!/usr/bin/env node
// Bundles <dir>/prototype.tsx with @gdgjp/design-system into one self-contained HTML file.
//
//   node build.mjs <dir> [--out <file>] [--fonts] [--dev] [--no-typecheck] [--title <title>]
//
// Writes <dir>/index.html by default. <dir>/spec.md, when present, becomes the 仕様 tab.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Vite and Tailwind register module hooks through an API Node now flags as deprecated.
process.noDeprecation = true;

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = join(skillDir, "runtime");
const repoDir = resolve(skillDir, "../../..");
export const dsDir = join(repoDir, "packages/design-system");
const dsModules = join(dsDir, "node_modules");

function fail(message) {
  const error = new Error(message);
  error.expected = true;
  throw error;
}

function assertDesignSystem() {
  if (!existsSync(join(dsDir, "src/index.ts")))
    fail(
      `Design system source not found at ${dsDir}.\nRun: git submodule update --init packages/design-system && pnpm install`,
    );
  if (!existsSync(join(dsModules, "vite")) || !existsSync(join(dsModules, "@tailwindcss/vite")))
    fail(`Design system dependencies are missing in ${dsModules}.\nRun: pnpm install`);
}

/** Imports an ESM package installed for the design system (the prototype dir has no node_modules). */
async function importFromDesignSystem(name) {
  const pkgDir = await realpath(join(dsModules, name));
  const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
  let entry = pkg.exports?.["."] ?? pkg.exports ?? pkg.module ?? pkg.main ?? "index.js";
  while (entry && typeof entry === "object") entry = entry.import ?? entry.default ?? entry.node;
  return import(pathToFileURL(join(pkgDir, entry)).href);
}

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "shots")
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function typecheck(dir, buildDir) {
  const files = await sourceFiles(dir);
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      lib: ["DOM", "DOM.Iterable", "ES2022"],
      module: "ESNext",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
      types: [],
      paths: {
        "@gdgjp/design-system": [join(dsDir, "src/index.ts")],
        "prototype-kit": [join(runtimeDir, "kit.ts")],
        "*": [`${dsModules}/@types/*`, `${dsModules}/*`],
      },
    },
    // The runtime is checked too, so a design-system API change surfaces here and not as a
    // blank page.
    files: [join(runtimeDir, "env.d.ts"), join(runtimeDir, "main.tsx"), ...files],
  };
  const configPath = join(buildDir, "tsconfig.json");
  await writeFile(configPath, JSON.stringify(tsconfig, null, 2));
  const tsc = join(await realpath(join(dsModules, "@typescript/native")), "bin/tsc");
  try {
    // Run from the prototype dir so its own files are reported with plain relative paths.
    execFileSync(process.execPath, [tsc, "-p", configPath, "--pretty", "false"], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    // Report errors in the prototype itself; the design system is checked by its own CI.
    // Continuation lines (indented) belong to the error above them.
    const own = [];
    let keep = false;
    for (const line of output.split("\n")) {
      if (!line.startsWith(" ")) keep = !line.startsWith("../") && !line.startsWith("/");
      if (keep) own.push(line);
    }
    if (own.length) fail(`Type errors in the prototype:\n${own.join("\n")}`);
    fail(`TypeScript failed outside the prototype (environment problem?):\n${output}`);
  }
}

/**
 * Markdown turns a line break into a space, which reads as a stray gap in Japanese prose written
 * one sentence per line. Join such lines, leaving code blocks, lists, tables and headings alone.
 */
export function joinJapaneseLines(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const previous = out.at(-1);
    if (
      !fenced &&
      previous !== undefined &&
      /\P{ASCII}$/u.test(previous) &&
      /^\P{ASCII}/u.test(line) &&
      !/^\s*(```|~~~|#)/.test(previous)
    )
      out[out.length - 1] = previous + line;
    else out.push(line);
  }
  return out.join("\n");
}

async function renderSpec(dir, log) {
  const specPath = join(dir, "spec.md");
  if (!existsSync(specPath)) return "";
  const markdown = joinJapaneseLines(await readFile(specPath, "utf8"));
  const wikiMarked = join(repoDir, "apps/wiki/node_modules/marked");
  if (existsSync(wikiMarked)) {
    const pkgDir = await realpath(wikiMarked);
    const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
    let entry = pkg.exports?.["."] ?? pkg.module ?? pkg.main;
    while (entry && typeof entry === "object") entry = entry.import ?? entry.default;
    const { marked } = await import(pathToFileURL(join(pkgDir, entry)).href);
    return marked.parse(markdown, { gfm: true });
  }
  log("Warning: marked was not found in apps/wiki; the 仕様 tab shows spec.md as plain text.");
  return `<pre>${escapeHtml(markdown)}</pre>`;
}

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function guessTitle(source) {
  return source.match(/\btitle:\s*(["'`])(.+?)\1/)?.[2] ?? "Prototype";
}

export async function buildPrototype({
  dir: inputDir,
  out,
  fonts = false,
  dev = false,
  typecheck: check = true,
  title,
  quiet = false,
}) {
  assertDesignSystem();
  const dir = await realpath(resolve(inputDir));
  const entry = join(dir, "prototype.tsx");
  if (!existsSync(entry)) fail(`Missing ${entry}`);
  // check and release builds use separate work dirs, so they can run at the same time.
  const buildDir = join(dir, ".build", dev ? "check" : "release");
  await mkdir(buildDir, { recursive: true });
  const log = (message) => quiet || console.log(message);

  if (check) {
    log("Type-checking…");
    await typecheck(dir, buildDir);
  }

  if (fonts) {
    // Google Sans Italic adds ~2 MB and prototypes rarely set italics; browsers synthesize it.
    const source = await readFile(join(dsDir, "src/styles/fonts.css"), "utf8");
    const faces = (source.match(/@font-face\s*{[^}]*}/g) ?? [])
      .filter((face) => !/font-style:\s*italic/.test(face))
      .map((face) => face.replaceAll("../../assets/", `${join(dsDir, "assets")}/`));
    await writeFile(join(buildDir, "fonts.css"), faces.join("\n"));
  }
  const css = [
    "@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;",
    `@import "${join(await realpath(join(dsModules, "tailwindcss")), "index.css")}";`,
    `@import "${join(dsDir, "src/styles/tailwind.css")}";`,
    `@import "${join(dsDir, "src/styles/components.css")}";`,
    fonts ? '@import "./fonts.css";' : "",
    `@source "${dir}/**/*.{ts,tsx}";`,
    `@source "${runtimeDir}/*.tsx";`,
  ];
  await writeFile(join(buildDir, "entry.css"), css.filter(Boolean).join("\n"));
  await writeFile(
    join(buildDir, "main.ts"),
    `import "./entry.css";\nimport "${join(runtimeDir, "main.tsx")}";\n`,
  );
  await writeFile(
    join(buildDir, "index.html"),
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./main.ts"></script></body></html>',
  );

  const { build } = await importFromDesignSystem("vite");
  const { default: tailwind } = await importFromDesignSystem("@tailwindcss/vite");
  const dsIndex = join(dsDir, "src/index.ts");
  const mode = dev ? "development" : "production";
  process.env.NODE_ENV = mode;
  log(`Bundling (${mode}${fonts ? ", fonts embedded" : ""})…`);
  await build({
    configFile: false,
    root: buildDir,
    base: "./",
    mode,
    logLevel: quiet ? "error" : "warn",
    plugins: [
      tailwind(),
      {
        // Bare imports from the prototype and runtime resolve from the design system's
        // node_modules, so there is exactly one React and one copy of every dependency.
        name: "resolve-from-design-system",
        enforce: "pre",
        async resolveId(source, importer, options) {
          if (!importer || importer.startsWith(dsDir)) return null;
          if (/^[./\0]/.test(source) || source.includes(":")) return null;
          return this.resolve(source, dsIndex, { ...options, skipSelf: true });
        },
      },
    ],
    resolve: {
      alias: [
        { find: /^prototype:entry$/, replacement: entry },
        { find: /^prototype-kit$/, replacement: join(runtimeDir, "kit.ts") },
        { find: /^@gdgjp\/design-system$/, replacement: dsIndex },
      ],
    },
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    build: {
      outDir: join(buildDir, "dist"),
      emptyOutDir: true,
      assetsInlineLimit: () => true,
      cssCodeSplit: false,
      modulePreload: false,
      minify: !dev,
      sourcemap: false,
      reportCompressedSize: false,
      rolldownOptions: {
        output: { codeSplitting: false },
        onwarn(warning, warn) {
          // "use client" directives in dependencies are irrelevant to a client-only bundle.
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  });

  const assetsDir = join(buildDir, "dist/assets");
  const assets = await readdir(assetsDir);
  const jsFiles = assets.filter((name) => name.endsWith(".js"));
  const cssFiles = assets.filter((name) => name.endsWith(".css"));
  if (jsFiles.length !== 1 || cssFiles.length > 1)
    fail(`Expected one JS and one CSS asset, got: ${assets.join(", ")}`);
  const js = (await readFile(join(assetsDir, jsFiles[0]), "utf8"))
    .replaceAll("</script", "<\\/script")
    .replaceAll("<!--", "<\\!--");
  const styles = cssFiles.length
    ? (await readFile(join(assetsDir, cssFiles[0]), "utf8")).replaceAll("</style", "<\\/style")
    : "";
  const spec = await renderSpec(dir, log);
  const pageTitle = title ?? guessTitle(await readFile(entry, "utf8"));

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(pageTitle)}</title>
<style id="proto-css">${styles}</style>
</head>
<body>
<div id="root"></div>
<template id="proto-spec">${spec}</template>
<script type="module" id="proto-js">${js}</script>
</body>
</html>
`;
  const outPath = resolve(out ?? join(dir, "index.html"));
  await writeFile(outPath, html);
  const size = (await stat(outPath)).size;
  log(`Wrote ${outPath} (${(size / 1024).toFixed(0)} KB)`);
  return { out: outPath, size, dir, buildDir };
}

export function parseArgs(argv) {
  const options = { fonts: false, dev: false, typecheck: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--fonts") options.fonts = true;
    else if (arg === "--dev") options.dev = true;
    else if (arg === "--no-typecheck") options.typecheck = false;
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--title") options.title = argv[++i];
    else if (arg.startsWith("--")) options[arg.slice(2)] = true;
    else rest.push(arg);
  }
  if (rest.length !== 1) {
    console.error(`Usage: node ${basename(fileURLToPath(import.meta.url))} <dir> [options]`);
    process.exit(2);
  }
  return { ...options, dir: rest[0] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await buildPrototype(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.expected ? error.message : error);
    process.exit(1);
  }
}
