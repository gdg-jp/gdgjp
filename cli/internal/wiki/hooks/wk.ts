/** The only filtered CLI surface for a local Wiki worktree. */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type Authz,
  findCloneRoot,
  isAlwaysVisible,
  isPagePath,
  loadAclSources,
  readPageMeta,
  resolveAuthz,
  resolveClonePath,
  sourceMetaFromManifest,
  sourceMetaFromMemory,
} from "./acl-core.ts";
import { AclInsertError, applyAclInsertForWrite, runCommitTripwire } from "./acl-insert-core.ts";
import {
  ACL_REDACTION_PLACEHOLDER,
  canClassesAccessSourceInChannel,
  canClassesSeePageInChannel,
  canMutatePage,
  parseAclSpans,
  redactAclSpans,
  validateAclSpans,
} from "./acl.ts";

type AclSpan = { start: number; end: number; srcIds: string[] };

function usage(): never {
  throw new Error("usage: wk read|grep|ls|write|rm|git …");
}
function fail(message: string): never {
  throw new Error(message);
}

function runId(): string {
  const id = process.env.GDG_WIKI_RUN_ID;
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id))
    fail("wk: missing valid GDG_WIKI_RUN_ID; retry from the agent launcher");
  return id;
}

function traceRead(root: string, rel: string): void {
  if (!rel.startsWith("raw/")) return;
  const path = join(root, ".gdgwiki", "ingest-trace", `${runId()}.json`);
  let trace: {
    runId: string;
    reads: string[];
    writes: string[];
    startedAt: number;
    baseRev?: string;
    sourceIds?: string[];
  } = {
    runId: runId(),
    reads: [],
    writes: [],
    startedAt: Date.now(),
  };
  try {
    trace = { ...trace, ...(JSON.parse(readFileSync(path, "utf8")) as typeof trace) };
  } catch {
    /* start a fresh invocation trace */
  }
  if (!Array.isArray(trace.reads)) trace.reads = [];
  if (!Array.isArray(trace.sourceIds)) trace.sourceIds = [];
  if (!trace.reads.includes(rel)) trace.reads.push(rel);
  // The directory is provisioned by the launcher. Do not silently use a shared trace.
  if (!existsSync(dirname(path))) fail("wk: invocation trace directory is missing");
  writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
}

function readRaw(path: string): string {
  try {
    if (lstatSync(path).isSymbolicLink()) fail("wk: symlinked files are not allowed");
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("wk:")) throw error;
    fail("wk: cannot read requested file");
  }
}

function canRead(root: string, rel: string, text: string, authz: Authz): boolean {
  if (isAlwaysVisible(rel)) return true;
  if (isPagePath(rel))
    return canClassesSeePageInChannel(readPageMeta(text), authz.classes, authz.channelAudience);
  if (rel.startsWith("raw/"))
    return canClassesAccessSourceInChannel(
      sourceMetaFromManifest(root, rel),
      authz.classes,
      authz.channelAudience,
    );
  if (rel.startsWith("memories/"))
    return canClassesAccessSourceInChannel(
      sourceMetaFromMemory(text),
      authz.classes,
      authz.channelAudience,
    );
  return true;
}

function filtered(root: string, rel: string, authz: Authz): string {
  const path = resolveClonePath(root, rel).absolute;
  const text = readRaw(path);
  if (!canRead(root, rel, text, authz))
    fail("wk: access denied for this file in the current channel");
  const sources = loadAclSources(root);
  const out = redactAclSpans(text, (span: AclSpan) =>
    span.srcIds.every((id: string) => {
      const source = sources[id];
      return (
        source !== undefined &&
        canClassesAccessSourceInChannel(source, authz.classes, authz.channelAudience)
      );
    }),
  ).markdown;
  traceRead(root, rel);
  return out;
}

function option(args: string[], name: string): number | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const raw = args[index + 1];
  if (!raw || !/^\d+$/.test(raw)) fail(`wk: ${name} requires a non-negative integer`);
  args.splice(index, 2);
  return Number(raw);
}

function readCommand(root: string, authz: Authz, args: string[]): void {
  const offset = option(args, "--offset") ?? 0;
  const limit = option(args, "--limit");
  if (args.length !== 1) usage();
  const rel = resolveClonePath(root, args[0]).rel;
  const lines = filtered(root, rel, authz).split("\n");
  process.stdout.write(
    `${lines.slice(offset, limit === null ? undefined : offset + limit).join("\n")}${lines.length > 0 ? "\n" : ""}`,
  );
}

function grepCommand(root: string, authz: Authz, args: string[]): void {
  if (args.length < 1) usage();
  const pattern = args.shift();
  if (pattern === undefined) usage();
  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern, "i");
  } catch {
    fail("wk: invalid grep pattern");
  }
  const paths = args.length ? args : ["."];
  for (const input of paths) {
    const { absolute, rel } = resolveClonePath(root, input);
    const entries = lstatSync(absolute).isDirectory() ? walk(root, absolute) : [{ rel, absolute }];
    for (const entry of entries) {
      const content = filtered(root, entry.rel, authz);
      for (const [line, value] of content.split("\n").entries())
        if (matcher.test(value)) process.stdout.write(`${entry.rel}:${line + 1}:${value}\n`);
    }
  }
}

function walk(root: string, directory: string): Array<{ absolute: string; rel: string }> {
  const out: Array<{ absolute: string; rel: string }> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walk(root, absolute));
    else out.push({ absolute, rel: resolveClonePath(root, absolute).rel });
  }
  return out;
}

function lsCommand(root: string, authz: Authz, args: string[]): void {
  if (args.length !== 1) usage();
  const { absolute } = resolveClonePath(root, args[0]);
  if (!lstatSync(absolute).isDirectory()) fail("wk: ls requires a directory");
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const candidate = join(absolute, entry.name);
    if (entry.isDirectory()) {
      process.stdout.write(`${entry.name}/\n`);
      continue;
    }
    const rel = resolveClonePath(root, candidate).rel;
    if (canRead(root, rel, readRaw(candidate), authz)) process.stdout.write(`${entry.name}\n`);
  }
}

function ensurePageWrite(
  root: string,
  input: string,
  content: string,
  authz: Authz,
): { absolute: string; rel: string; previous: string | null } {
  const resolved = resolveClonePath(root, input, true);
  if (!isPagePath(resolved.rel)) fail("wk: writes are limited to pages/**/page.md");
  const previous = existsSync(resolved.absolute) ? readRaw(resolved.absolute) : null;
  readPageMeta(content);
  const current = previous === null ? content : previous;
  if (!canMutatePage(authz.classes, readPageMeta(current)))
    fail("wk: current classes cannot modify this page");
  return { ...resolved, previous };
}

function restoreHidden(previous: string, submitted: string, root: string, authz: Authz): string {
  const sources = loadAclSources(root);
  const hidden = (parseAclSpans(previous) as AclSpan[]).filter(
    (span) =>
      !span.srcIds.every((id: string) => {
        const source = sources[id];
        return (
          source !== undefined &&
          canClassesAccessSourceInChannel(source, authz.classes, authz.channelAudience)
        );
      }),
  );
  let output = submitted;
  for (const span of hidden) {
    const at = output.indexOf(ACL_REDACTION_PLACEHOLDER);
    if (at < 0)
      fail("wk: refused: a hidden ACL span was removed or moved; keep its redaction placeholder");
    output = `${output.slice(0, at)}${previous.slice(span.start, span.end)}${output.slice(at + ACL_REDACTION_PLACEHOLDER.length)}`;
  }
  if (output.includes(ACL_REDACTION_PLACEHOLDER))
    fail("wk: refused: unexpected ACL redaction placeholder");
  return output;
}

function writeCommand(root: string, authz: Authz, args: string[]): void {
  if (args.length !== 1) usage();
  const content = readFileSync(0, "utf8");
  const target = ensurePageWrite(root, args[0], content, authz);
  const merged =
    target.previous === null ? content : restoreHidden(target.previous, content, root, authz);
  readPageMeta(merged);
  let tagged: string;
  try {
    tagged = applyAclInsertForWrite(root, target.rel, merged, runId());
  } catch (error) {
    if (error instanceof AclInsertError) fail(error.message);
    fail("wk: refused: automatic <acl> insertion failed; file was not written");
  }
  const valid = validateAclSpans(tagged);
  if (!valid.ok) fail("wk: refused: ACL spans are malformed");
  writeFileSync(target.absolute, tagged, "utf8");
}

function rmCommand(root: string, authz: Authz, args: string[]): void {
  if (args.length !== 1) usage();
  const target = ensurePageWrite(root, args[0], "---\nvisibility: private\n---\n", authz);
  if (target.previous === null) fail("wk: cannot remove a missing page");
  const sources = loadAclSources(root);
  const hasHiddenSpan = (parseAclSpans(target.previous) as AclSpan[]).some(
    (span) =>
      !span.srcIds.every((id: string) => {
        const source = sources[id];
        return (
          source !== undefined &&
          canClassesAccessSourceInChannel(source, authz.classes, authz.channelAudience)
        );
      }),
  );
  if (hasHiddenSpan) fail("wk: refused: this page contains ACL spans you cannot read");
  rmSync(target.absolute);
}

function hasGitFilter(root: string, path: string): boolean {
  const output = execFileSync("git", ["check-attr", "filter", "--", path], {
    cwd: root,
    encoding: "utf8",
  });
  return !output.trim().endsWith("filter: unspecified");
}

async function gitCommand(root: string, _authz: Authz, args: string[]): Promise<void> {
  const action = args.shift();
  if (!action || !["status", "add", "commit", "diff"].includes(action)) usage();
  if (action === "status" || action === "diff") {
    if (args.length !== 0) fail(`wk: git ${action} accepts no options or paths`);
  } else if (action === "add") {
    if (
      args.length === 0 ||
      args.some((path) => path.startsWith("-") || !isPagePath(resolveClonePath(root, path).rel))
    ) {
      fail("wk: git add is limited to explicit pages/**/page.md paths");
    }
    for (const path of args)
      if (hasGitFilter(root, path)) fail("wk: refusing git add through an attribute filter");
  } else if (args.length !== 2 || args[0] !== "-m" || !args[1]) {
    fail("wk: git commit requires only -m <message>");
  } else {
    const tripwire = await runCommitTripwire(root, runId());
    if (tripwire.warning) process.stderr.write(`${tripwire.warning}\n`);
    if (tripwire.deny) fail(tripwire.message);
  }
  // A unified diff cannot be safely reconstructed from independently-redacted
  // lines: diff prefixes break span boundaries. Names are sufficient for the
  // agent workflow and never expose an ACL span body.
  const gitArgs = [
    "-c",
    "core.hooksPath=/dev/null",
    action,
    ...(action === "commit" ? ["--no-verify"] : []),
    ...(action === "diff" ? ["--name-only"] : []),
    ...args,
  ];
  const output = execFileSync("git", gitArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_EDITOR: "true", GIT_PAGER: "cat" },
  });
  process.stdout.write(output);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();
  runId();
  const root = findCloneRoot();
  const authz = await resolveAuthz();
  switch (command) {
    case "read":
      readCommand(root, authz, args);
      break;
    case "grep":
      grepCommand(root, authz, args);
      break;
    case "ls":
      lsCommand(root, authz, args);
      break;
    case "write":
      writeCommand(root, authz, args);
      break;
    case "rm":
      rmCommand(root, authz, args);
      break;
    case "git":
      await gitCommand(root, authz, args);
      break;
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "wk: failed"}\n`);
  process.exitCode = 1;
});
