/**
 * Cursor preToolUse gate. Denies every read/write path except wk.
 * Does not evaluate ACL classes — that lives in wk.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { findCloneRoot } from "./acl-core.ts";
import { untaggedStagedAdds } from "./commit-tripwire.ts";
import { inspectWkScript, isGitCommitInvocation } from "./shell-allowlist.ts";

/** Named allowlist: unknown tool names are deny. */
const PASSTHROUGH_TOOLS = new Set(["Read", "Grep", "List", "Shell"]);
const MCP_ALLOWLIST = new Set(["search"]);
const GATED_PREFIXES = ["pages/", "raw/", "memories/"];

type ToolInput = {
  command?: unknown;
  cwd?: unknown;
  file_path?: unknown;
  glob?: unknown;
  path?: unknown;
  pattern?: unknown;
  target_directory?: unknown;
};

type HookPayload = {
  cwd?: unknown;
  file_path?: unknown;
  path?: unknown;
  tool_input?: ToolInput;
  tool_name?: unknown;
};

function readStdin(): string {
  try {
    return readFileSync(0, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePayload(raw: string): HookPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function cloneRootOrNull(start: string): string | null {
  try {
    return findCloneRoot(start);
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toolPath(payload: HookPayload): string | null {
  const input = payload.tool_input;
  return (
    stringField(input?.file_path) ??
    stringField(input?.path) ??
    stringField(input?.target_directory) ??
    stringField(payload.file_path) ??
    stringField(payload.path)
  );
}

function toolCwd(payload: HookPayload, fallback: string): string {
  return stringField(payload.tool_input?.cwd) ?? stringField(payload.cwd) ?? fallback;
}

function toPosix(rel: string): string {
  return rel.split(sep).join("/");
}

function isAncestor(ancestor: string, child: string): boolean {
  const top = toPosix(ancestor).replace(/\/+$/, "");
  const inner = toPosix(child);
  return inner === top || inner.startsWith(`${top}/`);
}

function classifyPath(root: string | null, input: string, cwd: string): "gated" | "other" {
  const abs = resolve(cwd, input);
  let target = abs;
  try {
    if (existsSync(abs)) target = realpathSync(abs);
  } catch {
    target = abs;
  }
  if (root) {
    const rel = toPosix(relative(root, target));
    if (!rel) return "gated";
    if (rel === ".." || rel.startsWith("../")) {
      return isAncestor(target, root) ? "gated" : "other";
    }
    if (GATED_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) {
      return "gated";
    }
    return "other";
  }
  const posix = toPosix(target);
  if (
    GATED_PREFIXES.some(
      (prefix) => posix.includes(`/${prefix}`) || posix.endsWith(`/${prefix.slice(0, -1)}`),
    )
  ) {
    return "gated";
  }
  return "other";
}

function wkReadHint(input: string | null, cwd: string, root: string | null): string {
  if (!input) return "wk read <path>";
  const abs = resolve(cwd, input);
  let target = abs;
  try {
    if (existsSync(abs)) target = realpathSync(abs);
  } catch {
    target = abs;
  }
  if (!root) return `wk read ${input}`;
  const rel = toPosix(relative(root, target));
  if (!rel || rel.startsWith("..")) return `wk read ${input}`;
  return `wk read ${rel}`;
}

function wkHint(tool: string, input: string | null, cwd: string, root: string | null): string {
  const pathHint = wkReadHint(input, cwd, root).replace(/^wk read /, "");
  if (tool === "Grep") return `wk grep <pattern> ${pathHint === "<path>" ? "pages/" : pathHint}`;
  if (tool === "List") return `wk ls ${pathHint === "<path>" ? "pages/" : pathHint}`;
  return `wk read ${pathHint}`;
}

function audit(root: string | null, permission: "allow" | "deny", tool: string): void {
  const line = `acl-gate: ${permission} ${tool}\n`;
  process.stderr.write(line);
  if (!root) return;
  try {
    const auditPath = join(root, ".gdgwiki", "acl-gate-audit.log");
    appendFileSync(auditPath, `${Date.now()} ${permission} ${tool}\n`);
  } catch {
    /* audit is best-effort */
  }
}

function deny(root: string | null, tool: string, agentMessage: string): void {
  audit(root, "deny", tool);
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      agent_message: agentMessage,
      user_message: "ACL gate blocked a tool call.",
    }),
  );
  process.exit(0);
}

function allow(root: string | null, tool: string): void {
  audit(root, "allow", tool);
  process.exit(0);
}

function resolveGdgBin(): string {
  return process.env.GDG_BIN || "gdg";
}

function verifyAclFailOpen(root: string): void {
  const gdg = resolveGdgBin();
  const result = spawnSync(gdg, ["wiki", "verify-acl"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 5_000,
  });
  if (result.error || result.status === null) {
    process.stderr.write("acl-gate: verify-acl unavailable; allowing commit (fail open)\n");
    return;
  }
  if (result.status === 1) {
    const findings = (result.stdout || result.stderr || "ACL check failed").trim();
    deny(
      root,
      "Shell",
      `gdg wiki verify-acl failed.\n${findings}\nFix the findings, then retry: wk git commit -m <message>`,
    );
  }
  if (result.status !== 0) {
    process.stderr.write(
      `acl-gate: verify-acl exited ${result.status}; allowing commit (fail open)\n`,
    );
  }
}

function handleReadLike(
  tool: string,
  payload: HookPayload,
  root: string | null,
  cwd: string,
): void {
  const input = toolPath(payload);
  if (!input) {
    const hint = tool === "Grep" ? "wk grep <pattern> <path>" : "wk ls <path>";
    deny(root, tool, `${tool} without a path would search gated trees. Use ${hint}.`);
    return;
  }
  if (input && classifyPath(root, input, cwd) === "gated") {
    deny(
      root,
      tool,
      `pages/, raw/, and memories/ must be read through wk: ${wkHint(tool, input, cwd, root)}`,
    );
    return;
  }
  allow(root, tool);
}

function handleShell(payload: HookPayload, root: string | null): void {
  const command = payload.tool_input?.command ?? (payload as { command?: unknown }).command;
  if (typeof command !== "string") {
    deny(root, "Shell", "Use wk for all shell work, for example: wk read pages/x/page.md");
    return;
  }
  const inspected = inspectWkScript(command);
  if (!inspected.ok) {
    deny(root, "Shell", `${inspected.reason}. Use wk only, for example: wk read pages/x/page.md`);
    return;
  }
  if (isGitCommitInvocation(inspected.simples)) {
    if (!root) {
      deny(root, "Shell", "wk git commit requires a Wiki clone. Run it from the clone root.");
      return;
    }
    const untagged = untaggedStagedAdds(root);
    if (untagged.length > 0) {
      const listed = untagged.slice(0, 8).join(", ");
      deny(
        root,
        "Shell",
        `Possible gate bypass: untagged added lines in the index (${listed}). Do not restage around the gate. Rewrite through wk write, then wk git add and wk git commit.`,
      );
      return;
    }
    verifyAclFailOpen(root);
  }
  allow(root, "Shell");
}

function handleMcp(tool: string, root: string | null): void {
  const name = tool.slice("MCP:".length);
  if (MCP_ALLOWLIST.has(name)) {
    allow(root, tool);
    return;
  }
  deny(root, tool, "The only MCP tool this agent may use is search.");
}

function mutateHint(tool: string): string {
  if (tool === "Delete") return "Removing a page: wk rm pages/<slug>/page.md";
  return "Write through wk, for example: wk write pages/x/page.md <<'EOF'\n...\nEOF";
}

function main(): void {
  const payload = parsePayload(readStdin());
  if (!payload) {
    deny(null, "unknown", "Malformed hook payload. Use wk for Wiki reads and writes.");
    return;
  }
  const tool = stringField(payload.tool_name) ?? "";
  const cwd = toolCwd(payload, process.cwd());
  const root = cloneRootOrNull(cwd) ?? cloneRootOrNull(process.cwd());

  if (tool === "Shell") {
    handleShell(payload, root);
    return;
  }
  if (tool.startsWith("MCP:")) {
    handleMcp(tool, root);
    return;
  }
  if (PASSTHROUGH_TOOLS.has(tool) && tool !== "Shell") {
    handleReadLike(tool, payload, root, cwd);
    return;
  }
  deny(root, tool || "unknown", `${tool || "This tool"} is blocked. ${mutateHint(tool)}`);
}

main();
