import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const mappings = Object.entries(JSON.parse(readFileSync("scripts/docs-moves.json", "utf8")));
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter((path) => path && existsSync(path) && lstatSync(path).isFile());
mappings.sort(([left], [right]) => right.length - left.length);
const destination = (path) => {
  const match = mappings.find(([from]) => path === from || path.startsWith(`${from}/`));
  return match ? match[1] + path.slice(match[0].length) : path;
};
const edits = [];
for (const file of files) {
  const target = destination(file);
  if (target !== file && existsSync(target)) throw new Error(`Refusing to replace ${target}`);
  if (!/\.(?:md|mdc|mjs|json|ts|tsx|go|toml|ya?ml|sh|txt)$/.test(file)) {
    if (target !== file) edits.push({ file, target });
    continue;
  }
  if (
    file === "scripts/docs-moves.json" ||
    file === "scripts/reorganize-docs.mjs" ||
    file === ".github/scripts/reorganize-docs.test.mjs"
  )
    continue;
  const before = readFileSync(file, "utf8");
  let after = before;
  if (file.endsWith(".md")) {
    let fence;
    after = after
      .split(/(?<=\n)/)
      .map((line) => {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
        if (fence) {
          if (
            marker &&
            marker[1][0] === fence[0] &&
            marker[1].length >= fence.length &&
            !marker[2].trim()
          )
            fence = undefined;
          return line;
        }
        if (marker) {
          fence = marker[1];
          return line;
        }
        return line.replace(/(\]\()([^\s)]+)([^)]*\))/g, (match, open, href, close) => {
          if (/^(?:[a-z][a-z\d+.-]*:|#|\/|<)/i.test(href)) return match;
          const [path, suffix = ""] = href.split(/(?=[?#])/s);
          const resolved = relative(root, resolve(dirname(file), decodeURIComponent(path)));
          const moved = destination(resolved);
          if (moved === resolved && file === target) return match;
          const next = relative(dirname(target), moved) || ".";
          return `${open}${next}${suffix}${close}`;
        });
      })
      .join("");
  }
  for (const [from, to] of mappings) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w/.-])((?:\\.\\./)*)${escaped}(?![\\w.-])`, "g");
    after = after.replace(pattern, (_, prefix) => prefix + to);
  }
  if (file.endsWith("/03a-agents-md.md")) {
    const seed = (text) => /````markdown\n([\s\S]*?)\n````/.exec(text)?.[1];
    if (seed(before) !== seed(after)) throw new Error("Refusing to change the runtime Wiki seed");
  }
  if (target !== file || after !== before) edits.push({ file, target, after });
}
const apply = process.argv.length === 3 && process.argv[2] === "--apply";
if (process.argv.length > 2 && !apply)
  throw new Error("Use --apply, or no arguments for a preview");
for (const { file, target, after } of edits) {
  console.log(target === file ? `update ${file}` : `move ${file} -> ${target}`);
  if (!apply) continue;
  mkdirSync(dirname(target), { recursive: true });
  if (target !== file) renameSync(file, target);
  if (after !== undefined) writeFileSync(target, after);
}
console.log(`${apply ? "Applied" : "Planned"} ${edits.length} file changes`);
