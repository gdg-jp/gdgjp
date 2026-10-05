import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isAlwaysVisible } from "./acl-core.ts";

const SPAN_OPEN = `<${"acl"}`;
const SPAN_CLOSE = `</${"acl"}>`;

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_PAGER: "cat" },
  });
}

function frontMatterEndLine(text: string): number {
  if (!text.startsWith("---\n")) return 0;
  const close = text.indexOf("\n---\n", 4);
  if (close < 0) return 0;
  return text.slice(0, close + 5).split("\n").length - 1;
}

function spanRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf(SPAN_OPEN, cursor);
    if (open < 0) break;
    const gt = text.indexOf(">", open);
    if (gt < 0) break;
    const close = text.indexOf(SPAN_CLOSE, gt + 1);
    if (close < 0) return [];
    ranges.push({ start: open, end: close + SPAN_CLOSE.length });
    cursor = close + SPAN_CLOSE.length;
  }
  return ranges;
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function lineCovered(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some((range) => start >= range.start && end <= range.end);
}

function addedLineNumbers(diff: string): Map<string, number[]> {
  const added = new Map<string, number[]>();
  let path = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      path = match?.[2] ?? "";
      continue;
    }
    if (line.startsWith("+++ b/")) {
      path = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk || !path) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count <= 0) continue;
    const list = added.get(path) ?? [];
    for (let offset = 0; offset < count; offset += 1) list.push(start + offset);
    added.set(path, list);
  }
  return added;
}

/** Index-only tripwire: untagged added body lines mean a write bypassed wk. */
export function untaggedStagedAdds(root: string): string[] {
  let diff: string;
  try {
    diff = git(root, ["diff", "--cached", "-U0", "--", "pages/"]);
  } catch {
    return ["cannot read git index"];
  }
  if (!diff.trim()) return [];
  const findings: string[] = [];
  for (const [rel, lines] of addedLineNumbers(diff)) {
    if (!rel.startsWith("pages/") || !rel.endsWith("/page.md")) continue;
    if (isAlwaysVisible(rel)) continue;
    let staged: string;
    try {
      staged = git(root, ["show", `:${rel}`]);
    } catch {
      findings.push(rel);
      continue;
    }
    const worktree = join(root, rel);
    if (existsSync(worktree)) {
      try {
        if (readFileSync(worktree, "utf8") === staged) continue;
      } catch {
        /* compare failed; inspect the index */
      }
    }
    const ranges = spanRanges(staged);
    const offsets = lineOffsets(staged);
    const fmEnd = frontMatterEndLine(staged);
    const stagedLines = staged.split("\n");
    for (const lineNo of lines) {
      const text = stagedLines[lineNo - 1] ?? "";
      if (text.trim() === "") continue;
      if (lineNo <= fmEnd) continue;
      const start = offsets[lineNo - 1] ?? 0;
      const end = start + text.length;
      if (!lineCovered(start, end, ranges)) findings.push(`${rel}:${lineNo}`);
    }
  }
  return findings;
}
