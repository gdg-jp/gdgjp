/**
 * Automatic `<acl src>` insertion for `wk write`.
 *
 * Conservative over-tagging: every wrap-eligible added line is wrapped with
 * the full AND of confidential sources this run read or locked. Exclusion
 * rules and ADR-020 refusals live only in this file.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyAclViaAuthz } from "./acl-core.ts";
import { parseAclSpans, validateAclSpans } from "./acl.ts";

export class AclInsertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AclInsertError";
  }
}

type ManifestDocument = {
  documentId?: unknown;
  sourceId?: unknown;
  path?: unknown;
  visibility?: unknown;
};

type ManifestState = {
  manifest?: { documents?: ManifestDocument[] };
};

type RunTrace = {
  baseRev?: unknown;
  reads?: unknown;
  sourceIds?: unknown;
};

type Line = { start: number; end: number; text: string };

export type SourceRef = { sourceId: string; path: string; visibility: string };

function failInsert(message: string): never {
  throw new AclInsertError(message);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Source visibilities that do not require `<acl>` tags. */
export function sourceNeedsAclTag(visibility: string): boolean {
  return visibility !== "member";
}

export function isCatalogOrLogPage(rel: string): boolean {
  return /^pages\/[^/]+\/page\.md$/.test(rel);
}

function isHeadingLine(text: string): boolean {
  return text.startsWith("#");
}

function isEmptyOrListMarkerOnly(text: string): boolean {
  return /^\s*$/.test(text) || /^\s*(?:[-*+]|\d+[.)])\s*$/.test(text);
}

function frontMatterRange(markdown: string): { start: number; end: number } | null {
  if (!markdown.startsWith("---\n")) return null;
  const close = markdown.indexOf("\n---\n", 4);
  if (close < 0) return null;
  return { start: 0, end: close + "\n---\n".length };
}

function codeFenceRanges(markdown: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < markdown.length) {
    const open = markdown.indexOf("```", i);
    if (open < 0) break;
    const close = markdown.indexOf("```", open + 3);
    if (close < 0) {
      ranges.push({ start: open, end: markdown.length });
      break;
    }
    ranges.push({ start: open, end: close + 3 });
    i = close + 3;
  }
  return ranges;
}

function inRange(index: number, ranges: readonly { start: number; end: number }[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

export function linesOf(markdown: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start <= markdown.length) {
    const nl = markdown.indexOf("\n", start);
    if (nl < 0) {
      if (start < markdown.length)
        lines.push({ start, end: markdown.length, text: markdown.slice(start) });
      break;
    }
    lines.push({ start, end: nl, text: markdown.slice(start, nl) });
    start = nl + 1;
    if (start === markdown.length) break;
  }
  return lines;
}

/** New-file line indices that are not in the LCS against the base file. */
export function addedLineIndices(base: string, next: string): number[] {
  const a = linesOf(base).map((line) => line.text);
  const b = linesOf(next).map((line) => line.text);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  const at = (r: number, c: number): number => dp[r]?.[c] ?? 0;
  const set = (r: number, c: number, value: number): void => {
    const row = dp[r];
    if (row) row[c] = value;
  };
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      set(i, j, a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1)));
    }
  }
  const added: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      added.push(j);
      j += 1;
    }
  }
  while (j < b.length) {
    added.push(j);
    j += 1;
  }
  return added;
}

function resolveSourceId(readPath: string, documents: readonly SourceRef[]): string | null {
  const path = readPath.replace(/^\.\//, "");
  for (const doc of documents) {
    if (
      path === doc.path ||
      path.startsWith(`${doc.path}/`) ||
      path.startsWith(`raw/${doc.sourceId}/`)
    ) {
      return doc.sourceId;
    }
  }
  return null;
}

export function collectConfidentialSourceIds(input: {
  reads: string[];
  directSourceIds: string[];
  lockedSourceIds: string[];
  documents: SourceRef[];
  visibilityBySourceId: Record<string, string>;
}): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (id: string): void => {
    if (!id || seen.has(id)) return;
    const visibility = input.visibilityBySourceId[id];
    if (visibility === undefined)
      failInsert(
        `wk: refused: cannot resolve visibility for source ${id}; restore state.json / acl-sources.json`,
      );
    if (!sourceNeedsAclTag(visibility)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const locked of input.lockedSourceIds) add(locked);
  for (const direct of input.directSourceIds) add(direct);
  for (const readPath of input.reads) {
    const normalized = readPath.replace(/^\.\//, "");
    if (!normalized.startsWith("raw/")) continue;
    const id = resolveSourceId(normalized, input.documents);
    if (id === null) failInsert(`wk: refused: ${normalized} is not in the local source manifest`);
    add(id);
  }
  ids.sort();
  return ids;
}

function wrapSrcAttr(sourceIds: readonly string[]): string {
  return `<acl src="${sourceIds.join(" ")}">`;
}

export type InsertOutcome = { ok: true; markdown: string } | { ok: false; message: string };

export function insertAclSpans(
  rel: string,
  nextMarkdown: string,
  baseMarkdown: string,
  sourceIds: readonly string[],
): InsertOutcome {
  if (sourceIds.length === 0 || isCatalogOrLogPage(rel))
    return { ok: true, markdown: nextMarkdown };

  const fm = frontMatterRange(nextMarkdown);
  if (fm === null) {
    return {
      ok: false,
      message: `wk: refused: ${rel} is missing valid front matter; file was not written`,
    };
  }

  const added = new Set(addedLineIndices(baseMarkdown, nextMarkdown));
  const lines = linesOf(nextMarkdown);
  const fences = codeFenceRanges(nextMarkdown);
  const spans = parseAclSpans(nextMarkdown) as Array<{ start: number; end: number }>;
  const wrap: boolean[] = lines.map(() => false);

  for (const [index, line] of lines.entries()) {
    if (!added.has(index)) continue;
    if (fm && line.start < fm.end) continue;
    if (inRange(line.start, spans)) continue;
    if (isEmptyOrListMarkerOnly(line.text)) continue;
    if (isHeadingLine(line.text) || inRange(line.start, fences)) {
      return {
        ok: false,
        message: `wk: refused: ${rel}:${index + 1} is a heading or fenced line derived from ${sourceIds.join(" ")}. Move that content into a body paragraph that can be wrapped in <acl>, then retry wk write.`,
      };
    }
    wrap[index] = true;
  }

  const blocks: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < wrap.length; i++) {
    if (!wrap[i]) continue;
    const start = i;
    while (i + 1 < wrap.length && wrap[i + 1]) i += 1;
    blocks.push({ start, end: i });
  }
  if (blocks.length === 0) return { ok: true, markdown: nextMarkdown };

  const open = wrapSrcAttr(sourceIds);
  const close = "</acl>";
  let markdown = nextMarkdown;
  for (let b = blocks.length - 1; b >= 0; b--) {
    const block = blocks[b];
    if (block === undefined) continue;
    const from = lines[block.start]?.start ?? 0;
    const last = lines[block.end];
    const to = last === undefined ? markdown.length : last.end;
    const body = markdown.slice(from, to);
    const prefix = from > 0 && markdown[from - 1] !== "\n" ? "\n" : "";
    const suffix = to < markdown.length && markdown[to] !== "\n" ? "\n" : "";
    markdown = `${markdown.slice(0, from)}${prefix}${open}\n${body}\n${close}${suffix}${markdown.slice(to)}`;
  }
  const valid = validateAclSpans(markdown);
  if (!valid.ok)
    failInsert(
      "wk: refused: automatic <acl> insertion produced malformed spans; file was not written",
    );
  return { ok: true, markdown };
}

export function untaggedWrapEligibleAddedLines(
  rel: string,
  stagedMarkdown: string,
  headMarkdown: string,
  sourceIds: readonly string[],
): string[] {
  if (sourceIds.length === 0 || isCatalogOrLogPage(rel)) return [];
  const added = new Set(addedLineIndices(headMarkdown, stagedMarkdown));
  const lines = linesOf(stagedMarkdown);
  const fm = frontMatterRange(stagedMarkdown);
  const spans = parseAclSpans(stagedMarkdown) as Array<{ start: number; end: number }>;
  const findings: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!added.has(index)) continue;
    if (fm && line.start < fm.end) continue;
    if (inRange(line.start, spans)) continue;
    if (isEmptyOrListMarkerOnly(line.text)) continue;
    findings.push(`${rel}:${index + 1}`);
  }
  return findings;
}

function gitText(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function gitOk(root: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function loadDocuments(root: string): SourceRef[] {
  const statePath = join(root, ".gdgwiki", "state.json");
  if (!existsSync(statePath))
    failInsert("wk: refused: missing .gdgwiki/state.json; run gdg wiki raw pull");
  let state: ManifestState;
  try {
    state = readJson(statePath) as ManifestState;
  } catch {
    failInsert("wk: refused: cannot parse .gdgwiki/state.json");
  }
  const documents = state.manifest?.documents;
  if (!Array.isArray(documents)) failInsert("wk: refused: local source manifest is missing");
  const out: SourceRef[] = [];
  for (const doc of documents) {
    if (typeof doc.sourceId !== "string" || typeof doc.path !== "string") continue;
    if (typeof doc.visibility !== "string") continue;
    out.push({ sourceId: doc.sourceId, path: doc.path, visibility: doc.visibility });
  }
  return out;
}

function loadAclSourceVisibilities(root: string): Record<string, string> {
  const path = join(root, ".gdgwiki", "acl-sources.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = readJson(path) as Record<string, { visibility?: unknown }>;
    const out: Record<string, string> = {};
    if (!parsed || typeof parsed !== "object") return out;
    for (const [id, value] of Object.entries(parsed)) {
      if (value && typeof value.visibility === "string") out[id] = value.visibility;
    }
    return out;
  } catch {
    failInsert("wk: refused: cannot parse .gdgwiki/acl-sources.json");
  }
}

function lockOwner(): string {
  return (process.env.GDG_WIKI_LOCK_OWNER ?? "").trim();
}

function loadLockedSourceIds(root: string): string[] {
  const owner = lockOwner();
  if (!owner) return [];
  const path = join(root, ".gdgwiki", "ingest-locks.json");
  if (!existsSync(path)) return [];
  let parsed: { locks?: Record<string, { document_id?: unknown; owner?: unknown }> };
  try {
    parsed = readJson(path) as typeof parsed;
  } catch {
    failInsert("wk: refused: cannot parse .gdgwiki/ingest-locks.json");
  }
  const locks = parsed.locks;
  if (!locks || typeof locks !== "object") return [];
  const state = readJson(join(root, ".gdgwiki", "state.json")) as ManifestState;
  const docs = Array.isArray(state.manifest?.documents) ? state.manifest.documents : [];
  const ids: string[] = [];
  for (const [documentId, entry] of Object.entries(locks)) {
    if (!entry || entry.owner !== owner) continue;
    const id =
      typeof entry.document_id === "string" && entry.document_id ? entry.document_id : documentId;
    const match = docs.find((doc) => doc.documentId === id);
    if (match && typeof match.sourceId === "string") ids.push(match.sourceId);
  }
  return ids;
}

function loadRunTrace(
  root: string,
  runId: string,
): { baseRev: string; reads: string[]; sourceIds: string[] } {
  const path = join(root, ".gdgwiki", "ingest-trace", `${runId}.json`);
  if (!existsSync(path))
    failInsert("wk: refused: missing invocation trace; run gdg wiki ingest lock first");
  let trace: RunTrace;
  try {
    trace = readJson(path) as RunTrace;
  } catch {
    failInsert("wk: refused: cannot parse invocation trace");
  }
  const baseRev = typeof trace.baseRev === "string" ? trace.baseRev.trim() : "";
  if (!baseRev)
    failInsert("wk: refused: invocation trace has no BaseRev; run gdg wiki ingest lock");
  const reads = Array.isArray(trace.reads)
    ? trace.reads.filter((value): value is string => typeof value === "string")
    : [];
  const sourceIds = Array.isArray(trace.sourceIds)
    ? trace.sourceIds.filter((value): value is string => typeof value === "string")
    : [];
  return { baseRev, reads, sourceIds };
}

export function confidentialSourceIdsForRun(root: string, runId: string): string[] {
  const documents = loadDocuments(root);
  const visibilityBySourceId: Record<string, string> = { ...loadAclSourceVisibilities(root) };
  for (const doc of documents) visibilityBySourceId[doc.sourceId] = doc.visibility;
  const trace = loadRunTrace(root, runId);
  return collectConfidentialSourceIds({
    reads: trace.reads,
    directSourceIds: trace.sourceIds,
    lockedSourceIds: loadLockedSourceIds(root),
    documents,
    visibilityBySourceId,
  });
}

function baseMarkdownAt(root: string, rel: string, baseRev: string): string {
  if (!gitOk(root, ["cat-file", "-e", `${baseRev}^{commit}`]))
    failInsert("wk: refused: BaseRev is not a commit in this clone");
  if (!gitOk(root, ["cat-file", "-e", `${baseRev}:${rel}`])) return "";
  const text = gitText(root, ["show", `${baseRev}:${rel}`]);
  if (text === null) failInsert("wk: refused: cannot read BaseRev page content");
  return text;
}

/** Insert tags into a `wk write` payload. Throws AclInsertError on fail-closed refuse. */
export function applyAclInsertForWrite(
  root: string,
  rel: string,
  markdown: string,
  runId: string,
): string {
  const sourceIds = confidentialSourceIdsForRun(root, runId);
  const baseRev = loadRunTrace(root, runId).baseRev;
  const outcome = insertAclSpans(rel, markdown, baseMarkdownAt(root, rel, baseRev), sourceIds);
  if (!outcome.ok) failInsert(outcome.message);
  return outcome.markdown;
}

export type TripwireResult = { deny: boolean; message: string; warning?: string };

function stagedPageRels(root: string): { rels: string[]; warning?: string } {
  const out = gitText(root, ["diff", "--cached", "--name-only", "--", "pages/"]);
  if (out === null)
    return {
      rels: [],
      warning: "acl-gate: git diff --cached -- pages/ failed; allowing commit (fail open)",
    };
  return {
    rels: out
      .split("\n")
      .map((line) => line.trim())
      .filter((rel) => /^pages\/(?:[^/]+\/)*page\.md$/.test(rel)),
  };
}

function showAt(root: string, spec: string): string {
  return gitText(root, ["show", spec]) ?? "";
}

export function inspectIndexForUntagged(
  root: string,
  runId: string,
): { findings: string[]; warning?: string } {
  let sourceIds: string[] = [];
  try {
    sourceIds = confidentialSourceIdsForRun(root, runId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "source resolution failed";
    return {
      findings: [],
      warning: `acl-gate: ${detail}; allowing commit (fail open)`,
    };
  }
  if (sourceIds.length === 0) return { findings: [] };
  const staged = stagedPageRels(root);
  if (staged.warning) return { findings: [], warning: staged.warning };
  const findings: string[] = [];
  for (const rel of staged.rels) {
    findings.push(
      ...untaggedWrapEligibleAddedLines(
        rel,
        showAt(root, `:${rel}`),
        showAt(root, `HEAD:${rel}`),
        sourceIds,
      ),
    );
  }
  return { findings };
}

export async function runCommitTripwire(root: string, runId: string): Promise<TripwireResult> {
  const cached = gitText(root, ["diff", "--cached", "--name-only"]);
  if (cached === null) {
    return {
      deny: false,
      message: "",
      warning: "acl-gate: git diff --cached failed; allowing commit (fail open)",
    };
  }
  const inspected = inspectIndexForUntagged(root, runId);
  if (inspected.warning && inspected.findings.length === 0) {
    return { deny: false, message: "", warning: inspected.warning };
  }
  if (inspected.findings.length > 0) {
    return {
      deny: true,
      message: `wk: refused: untagged added lines in the index (${inspected.findings.join(", ")}). This may be a gate violation — writes must go through wk write. The worktree was not modified.`,
    };
  }
  return await runVerifyAclFailOpen(root);
}

export async function runVerifyAclFailOpen(root: string): Promise<TripwireResult> {
  if (process.env.XANGI_AUTHZ_SOCKET) {
    const outcome = await verifyAclViaAuthz();
    if (outcome.kind === "violation") {
      return {
        deny: true,
        message: `wk: refused: ACL verification failed.\n${outcome.findings}`,
      };
    }
    if (outcome.kind === "infra") {
      return {
        deny: false,
        message: "",
        warning: `acl-gate: verify-acl failed (${outcome.detail}); allowing commit (fail open)`,
      };
    }
    return { deny: false, message: "" };
  }
  const gdg = process.env.GDG_BIN || "gdg";
  try {
    const result = execFileSync(gdg, ["wiki", "verify-acl"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    void result;
    return { deny: false, message: "" };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status: unknown }).status)
        : null;
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout: unknown }).stdout)
        : "";
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    if (status === 1) {
      return {
        deny: true,
        message: `wk: refused: ACL verification failed.\n${(stdout || stderr).trim()}`,
      };
    }
    const detail = error instanceof Error ? error.message : "verify-acl unavailable";
    return {
      deny: false,
      message: "",
      warning: `acl-gate: verify-acl failed (${detail}); allowing commit (fail open)`,
    };
  }
}

const invokedDirectly = process.argv[1]?.includes("acl-insert-core.ts") === true;
if (invokedDirectly && process.argv[2] === "commit-tripwire") {
  try {
    const root = process.env.GDG_WIKI_ROOT || process.cwd();
    const runId = process.env.GDG_WIKI_RUN_ID || "";
    const result = await runCommitTripwire(root, runId);
    if (result.warning) process.stderr.write(`${result.warning}\n`);
    if (result.deny) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "acl insert tripwire failed"}; allowing commit (fail open)\n`,
    );
  }
}
