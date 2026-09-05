#!/usr/bin/env node
// Compiles the narrow ACL evaluator surface (src/acl/**) to dist/ and writes a
// self-contained dist/package.json so `npm publish` (run from inside dist/) never
// sees the workspace-only fields (private, devDependencies, react/radix peer deps,
// the src/-pointing exports map) that the rest of gdg-lib's package.json carries
// for pnpm workspace consumers. Publishing this narrow surface, not the whole
// package, is deliberate: see docs/agents-local-refactoring/13-xangi-packaging.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, "dist");

rmSync(distDir, { recursive: true, force: true });
execFileSync("tsc", ["-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });

// tsc emits the extensionless relative specifiers written in src/acl (this
// monorepo's tsconfig.base.json uses moduleResolution "Bundler", which never
// needs an extension). Plain Node ESM does need one, so add ".js" to every
// bare-specifier import/export before publishing.
function addJsExtensions(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      addJsExtensions(full);
      continue;
    }
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) continue;
    const text = readFileSync(full, "utf8");
    const fixed = text.replace(/from "(\.\.?\/[^"]+)"/g, (match, spec) => {
      const lastSegment = spec.split("/").pop();
      return lastSegment.includes(".") ? match : `from "${spec}.js"`;
    });
    if (fixed !== text) writeFileSync(full, fixed);
  }
}
addJsExtensions(distDir);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// GitHub Packages requires the published scope to match the owning org exactly
// (gdg-jp), which differs from the workspace-internal package name (@gdgjp/gdg-lib,
// used unchanged by every in-monorepo consumer). Only external consumers pulling
// from the registry see this name.
const publishManifest = {
  name: "@gdg-jp/gdg-lib",
  version: pkg.version,
  description: "ACL evaluator for GDG agent-host backends (published subset of @gdgjp/gdg-lib)",
  type: "module",
  main: "./agent.js",
  types: "./agent.d.ts",
  exports: {
    "./acl/agent": {
      types: "./agent.d.ts",
      import: "./agent.js",
    },
  },
  publishConfig: {
    registry: "https://npm.pkg.github.com",
  },
  repository: {
    type: "git",
    url: "git+https://github.com/gdg-jp/gdgjp.git",
    directory: "gdg-lib",
  },
};

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "package.json"), `${JSON.stringify(publishManifest, null, 2)}\n`);
