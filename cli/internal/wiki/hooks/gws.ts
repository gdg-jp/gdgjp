/**
 * The only filtered CLI surface for `gws` (googleworkspace/cli), mirroring wk.ts's
 * role for the Wiki. `/opt/gdg-agent/bin/gws` execs this, never the raw binary.
 *
 * Phase 2 stub: the token source is `GOOGLE_WORKSPACE_CLI_TOKEN` read directly from
 * this process's environment. Phase 3 replaces that read with a call through
 * resolveAuthz()'s authz-socket to vend a real per-Discord-user Workspace token.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isApprovedGwsArgs, loadGwsAllowlist } from "./shell-allowlist.ts";

/** Fixed, non-PATH trust boundary. Never overridable by inherited environment state. */
const GWS_BIN_PATH = "/opt/gdg-agent/bin/gws-bin";

function fail(message: string): never {
  throw new Error(message);
}

/** Phase 3 replaces this with the vended-token call over XANGI_AUTHZ_SOCKET. */
function resolveToken(): string {
  const token = process.env.GOOGLE_WORKSPACE_CLI_TOKEN;
  if (!token) fail("gws: no Google Workspace token available; connect Google Workspace and retry");
  return token;
}

/**
 * An unset (or default) GOOGLE_WORKSPACE_CLI_CONFIG_DIR does not prevent gws's
 * auth precedence from falling through to ~/.config/gws/credentials.json or ADC.
 * A fresh, empty, per-invocation directory must be created and pointed at
 * explicitly so any credential planted in the slot's normal $HOME is ignored.
 */
function freshConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "gdg-gws-config-"));
}

/**
 * Pure mediator core: exported so tests can inject a stub binary path as an
 * explicit dependency, without any environment-variable indirection reachable
 * by a deployed invocation. `main()` below always calls this with the fixed
 * GWS_BIN_PATH.
 */
export function runGwsMediator(args: string[], binPath: string): number {
  const approved = isApprovedGwsArgs(args, loadGwsAllowlist());
  if (!approved.ok) fail(`gws: ${approved.reason}`);

  const token = resolveToken();
  const configDir = freshConfigDir();

  const env = { ...process.env };
  env.GOOGLE_WORKSPACE_CLI_CLIENT_ID = undefined;
  env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET = undefined;
  env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = undefined;
  env.GOOGLE_WORKSPACE_CLI_TOKEN = token;
  env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = configDir;

  const result = spawnSync(binPath, args, {
    cwd: configDir,
    env,
    stdio: "inherit",
  });
  if (result.error) fail(`gws: failed to run gws-bin: ${result.error.message}`);
  return result.status ?? 1;
}

function main(): void {
  process.exitCode = runGwsMediator(process.argv.slice(2), GWS_BIN_PATH);
}

if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "gws: failed"}\n`);
    process.exitCode = 1;
  }
}
