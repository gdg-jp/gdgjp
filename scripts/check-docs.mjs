import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootFiles = new Set(["README.md", "AGENTS.md", "applications.md"]);
const rootDirectories = new Set([
  "archive",
  "engineering",
  "eval",
  "guides",
  "issues",
  "plans",
  "references",
  "roster",
]);
const entrypoints = [
  "README.md",
  "plans/README.md",
  "guides/README.md",
  "references/README.md",
  "archive/README.md",
];

function ignored(name) {
  return name === ".DS_Store" || name === "Thumbs.db" || name.startsWith("._");
}

function prose(text) {
  let fence;
  const lines = text.split("\n").map((line) => {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined;
      }
      return " ".repeat(line.length);
    }
    if (marker) {
      fence = marker[1];
      return " ".repeat(line.length);
    }
    return line.replace(/(`+)([^`]|`(?!\1))*?\1/g, (span) => " ".repeat(span.length));
  });
  return lines.join("\n");
}

function destination(text, start) {
  let index = start;
  while (/\s/.test(text[index] ?? "") && index < text.length) index += 1;
  const beginning = index;
  if (text[index] === "<") {
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") index += 2;
      else if (text[index] === ">") {
        return { target: text.slice(beginning + 1, index), end: index + 1 };
      } else if (text[index] === "\n") return undefined;
      else index += 1;
    }
    return undefined;
  }
  let depth = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") index += 2;
    else if (char === "(") {
      depth += 1;
      index += 1;
    } else if (char === ")") {
      if (!depth) break;
      depth -= 1;
      index += 1;
    } else if (/\s/.test(char)) break;
    else index += 1;
  }
  if (index === beginning || depth) return undefined;
  return { target: text.slice(beginning, index), end: index };
}

function inlineTarget(text, start) {
  const found = destination(text, start);
  if (!found) return undefined;
  let index = found.end;
  while (/\s/.test(text[index] ?? "") && index < text.length) index += 1;
  if (text[index] === ")") return found.target;
  if (!['"', "'", "("].includes(text[index])) return undefined;
  const closing = text[index] === "(" ? ")" : text[index];
  index += 1;
  while (index < text.length && text[index] !== closing) {
    index += text[index] === "\\" ? 2 : 1;
  }
  index += 1;
  while (/\s/.test(text[index] ?? "") && index < text.length) index += 1;
  return text[index] === ")" ? found.target : undefined;
}

function targets(text) {
  const clean = prose(text);
  const result = [];
  for (const match of clean.matchAll(/(?<!\\)\]\(/g)) {
    const target = inlineTarget(clean, match.index + 2);
    if (target) result.push({ target, index: match.index });
  }
  for (const match of clean.matchAll(/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*/gm)) {
    const found = destination(clean, match.index + match[0].length);
    if (found) result.push({ target: found.target, index: match.index });
  }
  return result;
}

function localPath(target) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(target)) return undefined;
  const path = target.replace(/\\(.)|[?#].*/g, (match, escaped) => escaped ?? "");
  return path ? decodeURIComponent(path) : undefined;
}

export function checkDocumentation(root) {
  const errors = [];
  const directory = resolve(root, "docs");
  if (!existsSync(directory)) return ["docs/: documentation directory is missing"];
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored(entry.name)) continue;
      const allowed = entry.isDirectory()
        ? rootDirectories.has(entry.name)
        : rootFiles.has(entry.name);
      if (!allowed) errors.push(`docs/${entry.name}: unexpected root documentation entry`);
    }
    for (const name of entrypoints) {
      if (!existsSync(join(directory, name)) || !statSync(join(directory, name)).isFile()) {
        errors.push(`docs/${name}: required entrypoint is missing`);
      }
    }
    function visit(current) {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (ignored(entry.name)) continue;
        const path = join(current, entry.name);
        const name = relative(directory, path);
        if (name === "archive") continue;
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && entry.name.endsWith(".md")) inspect(path);
      }
    }
    function inspect(path) {
      const text = readFileSync(path, "utf8");
      for (const { target, index } of targets(text)) {
        const name = relative(root, path);
        const line = text.slice(0, index).split("\n").length;
        try {
          const local = localPath(target);
          if (local && !existsSync(resolve(dirname(path), local))) {
            errors.push(`${name}:${line}: missing local target ${target}`);
          }
        } catch (error) {
          errors.push(`${name}:${line}: invalid local target ${target}: ${error.message}`);
        }
      }
    }
    visit(directory);
    const archiveIndex = join(directory, "archive/README.md");
    if (existsSync(archiveIndex)) inspect(archiveIndex);
  } catch (error) {
    errors.push(`docs/: cannot inspect documentation: ${error.message}`);
  }
  return errors.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkDocumentation(process.cwd());
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PASS documentation layout and local file links");
  }
}
