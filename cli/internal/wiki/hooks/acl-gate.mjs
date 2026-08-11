/**
 * Cursor project hook for Wiki ingest ACL gating.
 *
 * Usage (argv selects the event — Cursor stdin does not always include the name):
 *   node .gdgwiki/hooks/acl-gate.mjs read|write|shell
 *
 * Fail-open on malformed input, missing gdg, network errors. Exit 1 from
 * `gdg wiki verify-acl` means ACL violation and is the only deny path.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function findCloneRoot(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    if (existsSync(join(dir, ".gdgwiki", "config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function toRel(root, absoluteOrRel) {
  if (!absoluteOrRel || typeof absoluteOrRel !== "string") return null;
  const abs = resolve(absoluteOrRel);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..") || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join("/");
}

function loadTrace(root) {
  const path = join(root, ".gdgwiki", "ingest-trace.json");
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
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

function saveTrace(root, trace) {
  const dir = join(root, ".gdgwiki");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ingest-trace.json"), `${JSON.stringify(trace, null, 2)}\n`, "utf8");
}

function appendUnique(list, value) {
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

function appendRead(root, rel) {
  if (!rel || !rel.startsWith("raw/")) return;
  const trace = loadTrace(root);
  trace.reads = appendUnique(trace.reads, rel);
  saveTrace(root, trace);
}

function appendWrite(root, rel) {
  if (!rel || !rel.startsWith("pages/")) return;
  const trace = loadTrace(root);
  // Writes are audit-only pre-push; after push, verify-acl recovers the
  // submitted page set from this list when the git diff is empty.
  trace.writes = appendUnique(trace.writes, rel);
  saveTrace(root, trace);
}

function extractRawPaths(command, root) {
  if (!command || typeof command !== "string") return;
  const re = /(?:^|[\s"'`])((?:\.\/)?raw\/[^\s"'`;|&<>]+)/g;
  for (const match of command.matchAll(re)) {
    const rel = toRel(root, resolve(root, match[1]));
    if (rel) appendRead(root, rel);
  }
}

function resolveGdgBin() {
  if (process.env.GDG_BIN) return process.env.GDG_BIN;
  return "gdg";
}

function deny(findings) {
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      agent_message: `<acl> tagging is incomplete. ${findings}\nWrap the material from the listed source in <acl src="…">…</acl>, or lower the page visibility, then retry the commit.`,
      user_message: "ACL gate blocked a commit in the Wiki clone.",
    }),
  );
}

function handleShell(payload, root) {
  const command = payload.command ?? payload.tool_input?.command ?? "";
  extractRawPaths(command, root);

  if (!/\bgit\b[^;&|\n]*\b(commit|push)\b/.test(command)) {
    process.exit(0);
  }

  const gdg = resolveGdgBin();
  let result;
  try {
    result = spawnSync(gdg, ["wiki", "verify-acl"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
  } catch (error) {
    process.stderr.write(`acl-gate: failed to run ${gdg} wiki verify-acl: ${error}\n`);
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

function main() {
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

main();
