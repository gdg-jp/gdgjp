#!/usr/bin/env node
// Lists the public components of @gdgjp/design-system with their exact export names, grouped by
// the categories in DESIGN.md "## Components", and the story file that shows real usage.
//
//   node components.mjs
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { dsDir } from "./build.mjs";

const componentsDir = join(dsDir, "src/components");
if (!existsSync(componentsDir)) {
  console.error(
    `Design system source not found at ${dsDir}.\nRun: git submodule update --init packages/design-system`,
  );
  process.exit(1);
}

async function exportsOf(file) {
  if (!existsSync(file)) return [];
  const source = await readFile(file, "utf8");
  const names = [];
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|class|type|interface|enum)\s+(\w+)/gm,
  ))
    names.push(match[1] === "type" || match[1] === "interface" ? `${match[2]} (type)` : match[2]);
  for (const match of source.matchAll(/^export\s+(type\s+)?{([^}]*)}/gm))
    for (const raw of match[2].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "");
      if (!name) continue;
      const exported = name.split(/\s+as\s+/).pop();
      names.push(match[1] || raw.trim().startsWith("type ") ? `${exported} (type)` : exported);
    }
  return names;
}

async function componentExports(dir) {
  const index = await readFile(join(componentsDir, dir, "index.ts"), "utf8");
  const names = [];
  for (const match of index.matchAll(/export\s+(type\s+)?{([^}]*)}\s+from/g))
    for (const raw of match[2].split(",")) {
      const name = raw.trim();
      if (name)
        names.push(
          match[1] || name.startsWith("type ") ? `${name.replace(/^type\s+/, "")} (type)` : name,
        );
    }
  for (const match of index.matchAll(/export\s+\*\s+from\s+"\.\/(\w+)"/g)) {
    for (const ext of [".tsx", ".ts"]) {
      const file = join(componentsDir, dir, match[1] + ext);
      if (existsSync(file)) names.push(...(await exportsOf(file)));
    }
  }
  return [...new Set(names)];
}

const barrel = await readFile(join(componentsDir, "index.ts"), "utf8");
const dirs = [...barrel.matchAll(/from\s+"\.\/(\w+)"/g)].map((match) => match[1]);

const design = await readFile(join(dsDir, "DESIGN.md"), "utf8");
const section = design.split(/^## Components\s*$/m)[1]?.split(/^## /m)[0] ?? "";
const categories = new Map();
const order = [];
for (const block of section.split(/^### /m).slice(1)) {
  const title = block.split("\n")[0].trim();
  order.push(title);
  for (const match of block.matchAll(/`(\w+)`/g))
    if (dirs.includes(match[1]) && !categories.has(match[1])) categories.set(match[1], title);
}

const other = "Other (see the story for intended use)";
const groups = new Map([...order, other].map((title) => [title, []]));
for (const dir of dirs) {
  const category = categories.get(dir) ?? other;
  const files = await readdir(join(componentsDir, dir));
  const story = files.find((file) => file.endsWith(".stories.tsx"));
  const source = files.find((file) => file === `${dir}.tsx`);
  const paths = [
    story && `story: src/components/${dir}/${story}`,
    // The source shows default layout (direction, gaps, borders) that stories rarely vary.
    source && `source: src/components/${dir}/${source}`,
  ].filter(Boolean);
  const line = `- ${dir}: ${(await componentExports(dir)).join(", ")}${paths
    .map((path) => `\n    ${path}`)
    .join("")}`;
  groups.get(category).push(line);
}

console.log(`# @gdgjp/design-system components (${dirs.length})`);
console.log(
  `Source: ${dsDir}\nGuidance per category: DESIGN.md "## Components". Styles: src/styles/components.css\n`,
);
console.log("## Theme\n- ThemeProvider, ThemeToggle, useTheme (provided by the prototype host)\n");
for (const [category, lines] of groups)
  if (lines.length) console.log(`## ${category}\n${lines.join("\n")}\n`);
