/**
 * Reads the slot nonce + spawn spec and execs cursor-agent.
 * Invoked only from /opt/gdg-agent/bin/spawn-slot-<N>.
 * spawn-slot uses `exec` so leftover processes stay on the slot uid.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const slot = process.env.GDG_AGENT_SLOT ?? "";
if (!/^(0|[1-9]\d*)$/.test(slot)) {
  throw new Error("GDG_AGENT_SLOT must be a non-negative integer");
}

const runDir = `/run/gdg-agent/${slot}`;
const home = `/home/gdgagent-run-${slot}`;
const nonceLines = readFileSync(`${runDir}/nonce`, "utf8")
  .replace(/^\uFEFF/, "")
  .trim()
  .split("\n");
const nonce = nonceLines[0] ?? "";
const runId = nonceLines[1] ?? "";
if (!nonce || !runId) {
  throw new Error(`spawn-slot-${slot}: nonce file must contain nonce and GDG_WIKI_RUN_ID`);
}

type SpawnSpec = {
  command?: unknown;
  args?: unknown;
  cwd?: unknown;
  env?: unknown;
};

const spec = JSON.parse(readFileSync(`${runDir}/spawn.json`, "utf8")) as SpawnSpec;
if (typeof spec.command !== "string" || !isAbsolute(spec.command) || spec.command.includes("..")) {
  throw new Error(`spawn-slot-${slot}: command must be an absolute path`);
}
if (typeof spec.cwd !== "string" || !isAbsolute(spec.cwd) || spec.cwd.includes("..")) {
  throw new Error(`spawn-slot-${slot}: cwd must be an absolute path`);
}
const rawArgs = Array.isArray(spec.args) ? spec.args : [];
const args: string[] = [];
for (let i = 0; i < rawArgs.length; i += 1) {
  const value = rawArgs[i];
  if (typeof value !== "string") throw new Error(`spawn-slot-${slot}: args must be strings`);
  if (value === "--force" || value === "--yolo") continue;
  // cursor-agent 2026.08.11-e8db854 rejects unknown --mcp-config (exit 1).
  if (value === "--mcp-config") {
    i += 1;
    continue;
  }
  args.push(value);
}

const extraEnv =
  spec.env && typeof spec.env === "object" && !Array.isArray(spec.env)
    ? (spec.env as Record<string, unknown>)
    : {};
const cursorApiKey = extraEnv.CURSOR_API_KEY;
const env: NodeJS.ProcessEnv = {
  PATH: "/opt/gdg-agent/bin:/usr/bin:/bin",
  HOME: home,
  USER: `gdgagent-run-${slot}`,
  XANGI_AUTHZ_NONCE: nonce,
  XANGI_AUTHZ_SOCKET: `${runDir}/authz.sock`,
  GDG_WIKI_RUN_ID: runId,
};
if (typeof extraEnv.LANG === "string") env.LANG = extraEnv.LANG;
if (typeof extraEnv.TZ === "string") env.TZ = extraEnv.TZ;
if (typeof cursorApiKey === "string" && cursorApiKey) env.CURSOR_API_KEY = cursorApiKey;

// MCP servers come from $HOME/.cursor/mcp.json (root-owned). There is no CLI
// flag that pins or disables project mcp.json on this cursor-agent version.
const child = spawn(spec.command, args, {
  stdio: "inherit",
  cwd: spec.cwd,
  env,
});
const stopChild = () => {
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
};
process.on("SIGTERM", stopChild);
process.on("SIGINT", stopChild);
process.on("SIGHUP", stopChild);
child.on("error", (error) => {
  process.stderr.write(`spawn-slot-${slot}: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
