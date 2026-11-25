#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = process.argv[2] ? resolve(process.argv[2]) : join(root, "dist");

rmSync(distDir, { recursive: true, force: true });
// Run the compiler's JS entry with Node: on Windows `tsc` on PATH is tsc.cmd,
// which execFileSync cannot start without a shell.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json", "--outDir", distDir], {
  cwd: root,
  stdio: "inherit",
});

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
    directory: "packages/gdg-lib",
  },
};

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "package.json"), `${JSON.stringify(publishManifest, null, 2)}\n`);

const readme = `# ${publishManifest.name}

${publishManifest.description}. Import it from \`${publishManifest.name}/acl/agent\`.

## Span ACLs are not a security boundary

\`<acl>\` span tags (\`parseAclSpans\`, \`redactAclSpans\`, \`validateAclSpans\`) depend on the
LLM that wrote the page reporting its sources correctly. They only hide specific sentences
inside a page that is otherwise visible to the reader. Enforce access with the real boundaries:
raw source access (\`canClassesAccessSourceInChannel\`) and page-level visibility
(\`canClassesSeePageInChannel\`). Never rely on span redaction to protect content.
`;
writeFileSync(join(distDir, "README.md"), readme);
