import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function isCommentSource(path) {
  return (
    /\.(?:[cm]?[jt]sx?|go)$/.test(path) &&
    !/^(?:skills|apps\/learn|packages\/design-system)(?:\/|$)/.test(path) &&
    !/(?:^|\/)(?:node_modules|build|dist|\.react-router|\.wrangler|\.next|coverage|test-results|playwright-report|openapigen)(?:\/|$)/.test(
      path,
    ) &&
    !/(?:^|\/)(?:worker-configuration\.d\.ts|openapi\.gen\.go)$|\.generated\.[^/]+$|\/openapi\/types\.generated\.ts$/.test(
      path,
    ) &&
    !/^apps\/connpass\/fixtures\/html\/.*_files\//.test(path)
  );
}

function typescriptComments(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) {
    throw new Error(
      `${path}: cannot inspect syntax: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, " ")}`,
    );
  }
  const protectedRanges = [];
  const comments = new Map();
  function visit(node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      protectedRanges.push([node.getStart(source), node.end]);
    }
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ]) {
      comments.set(range.pos, { start: range.pos, end: range.end });
    }
    for (const child of node.getChildren(source)) visit(child);
  }
  visit(source);
  return [...comments.values()].filter(
    ({ start }) => !protectedRanges.some(([left, right]) => left <= start && start < right),
  );
}

function goComments(path, text) {
  const comments = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;
      let closed = false;
      while (index < text.length) {
        if (text[index] === quote) {
          index += 1;
          closed = true;
          break;
        }
        if (quote !== "`" && text[index] === "\\") index += 1;
        index += 1;
      }
      if (!closed) throw new Error(`${path}: unterminated Go literal`);
    } else if (text.startsWith("//", index)) {
      const start = index;
      const newline = text.indexOf("\n", index);
      index = newline < 0 ? text.length : newline;
      comments.push({ start, end: index });
    } else if (text.startsWith("/*", index)) {
      const start = index;
      const close = text.indexOf("*/", index + 2);
      if (close < 0) throw new Error(`${path}: unterminated Go comment`);
      index = close + 2;
      comments.push({ start, end: index });
    } else {
      index += 1;
    }
  }
  return comments;
}

function comments(path, text) {
  const ranges = path.endsWith(".go") ? goComments(path, text) : typescriptComments(path, text);
  return ranges.map(({ start, end }) => ({
    text: text.slice(start, end),
    line: text.slice(0, start).split("\n").length,
  }));
}

function filesAt(ref) {
  return git(["ls-tree", "-r", "--name-only", "-z", ref]).split("\0").filter(isCommentSource);
}

function contentAt(ref, path) {
  return git(["show", `${ref}:${path}`]);
}

function exceptions(root, options) {
  const name = "scripts/code-comment-exceptions.json";
  const path = resolve(root, name);
  let text;
  if (options.mode === "diff") {
    if (!git(["ls-tree", "--name-only", options.head, "--", name]).trim()) return [];
    text = contentAt(options.head, name);
  } else if (options.mode === "staged") {
    if (!git(["ls-files", "--cached", "--", name]).trim()) return [];
    text = contentAt("", name);
  } else {
    if (!existsSync(path)) return [];
    text = readFileSync(path, "utf8");
  }
  const record = JSON.parse(text);
  if (!Array.isArray(record.exceptions)) throw new Error(`${path}: expected exceptions array`);
  const keys = new Set();
  for (const item of record.exceptions) {
    if (
      !item ||
      typeof item.path !== "string" ||
      !isCommentSource(item.path) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !["legal", "external-contract", "public-api"].includes(item.category) ||
      ![item.reason, item.evidence].every((value) => typeof value === "string" && value.trim())
    ) {
      throw new Error(`${path}: invalid reviewed exception`);
    }
    const key = `${item.path}:${item.sha256}`;
    if (keys.has(key)) throw new Error(`${path}: duplicate exception ${key}`);
    keys.add(key);
  }
  return record.exceptions;
}

function parseArgs(args) {
  if (args.length === 0) return { mode: "working", base: "HEAD" };
  if (args.length === 1 && args[0] === "--staged") return { mode: "staged", base: "HEAD" };
  if (args.length === 3 && args[0] === "--diff") {
    return { mode: "diff", base: args[1], head: args[2] };
  }
  if (args.length > 1 && args[0] === "--files") return { mode: "files", files: args.slice(1) };
  throw new Error(
    "Usage: node scripts/check-code-comments.mjs [--staged | --diff BASE HEAD | --files PATH...]",
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(root);
  if (options.base)
    options.base = git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${options.base}^{commit}`,
    ]).trim();
  if (options.head)
    options.head = git([
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${options.head}^{commit}`,
    ]).trim();
  const reviewed = exceptions(root, options);
  const baseFiles = options.base ? new Set(filesAt(options.base)) : new Set();
  let paths;
  if (options.mode === "diff") {
    paths = git([
      "diff",
      "--name-only",
      "--diff-filter=ACMRT",
      "--no-renames",
      "-z",
      options.base,
      options.head,
    ]).split("\0");
  } else if (options.mode === "staged") {
    paths = git([
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRT",
      "--no-renames",
      "-z",
      options.base,
    ]).split("\0");
  } else if (options.mode === "files") {
    paths = options.files.map((path) => {
      const local = relative(root, resolve(path));
      if (local.startsWith("../") || isAbsolute(local))
        throw new Error(`Path outside repository: ${path}`);
      return local;
    });
  } else {
    paths = [
      ...git([
        "diff",
        "--name-only",
        "--diff-filter=ACMRT",
        "--no-renames",
        "-z",
        options.base,
      ]).split("\0"),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
    ];
  }
  const failures = [];
  const selected = [...new Set(paths.filter(isCommentSource))];
  if (options.mode === "files" && paths.some((path) => !isCommentSource(path))) {
    throw new Error(
      "--files accepts first-party JS/TS/Go source files only; generated and submodule files are excluded",
    );
  }
  for (const path of selected) {
    const before = baseFiles.has(path) ? comments(path, contentAt(options.base, path)) : [];
    const remaining = new Map();
    for (const comment of before)
      remaining.set(comment.text, (remaining.get(comment.text) ?? 0) + 1);
    const text =
      options.mode === "diff"
        ? contentAt(options.head, path)
        : options.mode === "staged"
          ? contentAt("", path)
          : readFileSync(path, "utf8");
    for (const comment of comments(path, text)) {
      const count = remaining.get(comment.text) ?? 0;
      if (count > 0) {
        remaining.set(comment.text, count - 1);
        continue;
      }
      const sha256 = createHash("sha256").update(comment.text).digest("hex");
      if (reviewed.some((item) => item.path === path && item.sha256 === sha256)) continue;
      failures.push(`${path}:${comment.line}: new code comment (${sha256})`);
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    console.error(
      "Delete the comment and move what it says into code: a precise name, a type that rules out the bad state, an API that owns the constraint, or a test that fails without it. A workaround comment marks a cause to fix, not text to keep. For necessary legal, external-contract, or public-API explanations, add an exact reviewed exception to scripts/code-comment-exceptions.json with reason and evidence (docs/engineering/comments.md).",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `PASS no new code comments in ${selected.length} selected first-party JS/TS/Go files`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
