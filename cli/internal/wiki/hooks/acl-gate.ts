/**
 * Cursor project hook for Wiki ingest ACL gating.
 *
 * Usage (argv selects the event — Cursor stdin does not always include the name):
 *   node .gdgwiki/hooks/acl-gate.ts read|write|shell
 *
 * Insertion is `wk write` only. This file never inserts tags.
 * `wk git commit` runs the index tripwire in-process. This hook, when it still
 * sees a commit, delegates to the same tripwire if `acl-insert-core.ts` is
 * present, then fail-opens on infrastructure errors. Exit 1 from
 * `gdg wiki verify-acl` is an ACL violation; untagged index blobs are a
 * possible gate violation.
 */
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type HookPayload = {
  command?: unknown;
  file_path?: unknown;
  path?: unknown;
  tool_input?: {
    command?: unknown;
  };
};

type IngestTrace = {
  runId: string;
  startedAt: number;
  queueHeadDocumentId: string;
  reads: string[];
  writes: string[];
};

function readStdin(): string {
  try {
    return readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function parsePayload(raw: string): HookPayload {
  try {
    const payload: unknown = JSON.parse(raw || "{}");
    return typeof payload === "object" && payload !== null ? (payload as HookPayload) : {};
  } catch {
    return {};
  }
}

function findCloneRoot(start: string): string | null {
  let dir = resolve(start || process.cwd());
  for (;;) {
    if (existsSync(join(dir, ".gdgwiki", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function toRel(root: string, absoluteOrRel: unknown): string | null {
  if (!absoluteOrRel || typeof absoluteOrRel !== "string") return null;
  const abs = resolve(absoluteOrRel);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join("/");
}

function loadTrace(root: string): IngestTrace {
  const path = join(root, ".gdgwiki", "ingest-trace.json");
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<IngestTrace>;
    return {
      runId: parsed.runId || "",
      startedAt: parsed.startedAt || 0,
      queueHeadDocumentId: parsed.queueHeadDocumentId || "",
      reads: Array.isArray(parsed.reads) ? parsed.reads : [],
      writes: Array.isArray(parsed.writes) ? parsed.writes : [],
    };
  } catch {
    return {
      runId: `hook-${Date.now()}`,
      startedAt: Math.floor(Date.now() / 1000),
      queueHeadDocumentId: "",
      reads: [],
      writes: [],
    };
  }
}

function saveTrace(root: string, trace: IngestTrace): void {
  const dir = join(root, ".gdgwiki");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ingest-trace.json"), `${JSON.stringify(trace, null, 2)}\n`, "utf8");
}

function appendUnique(list: string[], value: string): string[] {
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

function appendRead(root: string, rel: string | null): void {
  if (!rel || !rel.startsWith("raw/")) return;
  const trace = loadTrace(root);
  trace.reads = appendUnique(trace.reads, rel);
  saveTrace(root, trace);
}

function appendWrite(root: string, rel: string | null): void {
  if (!rel || !rel.startsWith("pages/")) return;
  const trace = loadTrace(root);
  // Writes are audit-only pre-push; after push, verify-acl recovers the
  // submitted page set from this list when the git diff is empty.
  trace.writes = appendUnique(trace.writes, rel);
  saveTrace(root, trace);
}

function extractRawPaths(command: unknown, root: string): void {
  if (!command || typeof command !== "string") return;
  const re = /(?:^|[\s"'`])((?:\.\/)?raw\/[^\s"'`;|&<>]+)/g;
  for (const match of command.matchAll(re)) {
    const matchedPath = match[1];
    if (!matchedPath) continue;
    const rel = toRel(root, resolve(root, matchedPath));
    if (rel) appendRead(root, rel);
  }
}

function resolveGdgBin(): string {
  if (process.env.GDG_BIN) return process.env.GDG_BIN;
  return "gdg";
}

function deny(findings: string, gateViolation = false): void {
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      agent_message: gateViolation
        ? `<acl> tagging is incomplete and this may be a gate violation. ${findings}\nWrites must go through wk write so staged blobs already contain tags.`
        : `<acl> tagging is incomplete. ${findings}\nWrap the material from the listed source in <acl src="…">…</acl>, then retry the commit.`,
      user_message: "ACL gate blocked a commit in the Wiki clone.",
    }),
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}

function handleShell(payload: HookPayload, root: string): void {
  const command = payload.command ?? payload.tool_input?.command ?? "";
  extractRawPaths(command, root);

  if (typeof command !== "string" || !/\bgit\b[^;&|\n]*\b(commit|push)\b/.test(command)) {
    process.exit(0);
  }

  const gdg = resolveGdgBin();
  const insertCore = join(dirname(fileURLToPath(import.meta.url)), "acl-insert-core.ts");
  if (existsSync(insertCore) && /\bcommit\b/.test(command)) {
    let tripwire: SpawnSyncReturns<string>;
    try {
      tripwire = spawnSync(process.execPath, [insertCore, "commit-tripwire"], {
        cwd: root,
        encoding: "utf8",
        env: process.env,
      });
    } catch (error: unknown) {
      process.stderr.write(
        `acl-gate: commit tripwire unavailable (${formatUnknownError(error)}); falling through\n`,
      );
      tripwire = spawnSync(process.execPath, ["-e", "process.exit(3)"], { encoding: "utf8" });
    }
    if (tripwire.status === 2) {
      deny((tripwire.stderr || tripwire.stdout || "untagged index blob").trim(), true);
      process.exit(0);
    }
    if (tripwire.status === 0) {
      if (tripwire.stderr) process.stderr.write(tripwire.stderr);
      process.exit(0);
    }
    process.stderr.write("acl-gate: commit tripwire failed open; running verify-acl\n");
  }

  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(gdg, ["wiki", "verify-acl"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
  } catch (error: unknown) {
    process.stderr.write(
      `acl-gate: failed to run ${gdg} wiki verify-acl: ${formatUnknownError(error)}\n`,
    );
    process.exit(0);
  }

  if (result.error) {
    process.stderr.write(
      `acl-gate: ${gdg} wiki verify-acl unavailable (${result.error.message}); allowing command\n`,
    );
    process.exit(0);
  }

  if (result.status === 1) {
    const findings = (result.stdout || result.stderr || "ACL check failed").trim();
    deny(findings);
    process.exit(0);
  }

  if (result.status !== 0) {
    process.stderr.write(
      `acl-gate: verify-acl exited ${result.status}; allowing command (fail open)\n`,
    );
  }
  process.exit(0);
}

function main(): void {
  const mode = process.argv[2] || "";
  const payload = parsePayload(readStdin());
  const root = findCloneRoot(process.cwd());
  if (!root) process.exit(0);

  if (mode === "read") {
    const rel = toRel(root, payload.file_path ?? payload.path ?? "");
    if (rel) appendRead(root, rel);
    process.exit(0);
  }

  if (mode === "write") {
    const rel = toRel(root, payload.file_path ?? payload.path ?? "");
    if (rel) appendWrite(root, rel);
    process.exit(0);
  }

  if (mode === "shell") {
    handleShell(payload, root);
    return;
  }

  // Unknown mode: fail open.
  process.exit(0);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
