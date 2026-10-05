/**
 * The only filtered CLI surface for `gws` (googleworkspace/cli), mirroring wk.ts's
 * role for the Wiki. `/opt/gdg-agent/bin/gws` execs this, never the raw binary.
 *
 * The token source is the per-Discord-user flow: resolveAuthz() over the per-slot
 * authz socket resolves the invoking Discord user's linked GDG identity (gdgSub),
 * then resolveWorkspaceToken() exchanges it for a short-lived Google access token —
 * never a refresh token, never written to disk. The slot itself never holds any
 * long-lived credential and can never request a token for any identity other than
 * the one already bound to its own run.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAuthz, resolveWorkspaceToken } from "./acl-core.ts";
import { isApprovedGwsArgs, loadGwsAllowlist } from "./shell-allowlist.ts";

/** Fixed, non-PATH trust boundary. Never overridable by inherited environment state. */
const GWS_BIN_PATH = "/opt/gdg-agent/bin/gws-bin";

function fail(message: string): never {
  throw new Error(message);
}

function failNotConnected(): never {
  fail(
    "gws: connect Google Workspace first: run /login in Discord, then accounts.gdgs.jp/settings",
  );
}

async function resolveToken(): Promise<string> {
  const authz = await resolveAuthz();
  if (!authz.gdgSub) failNotConnected();

  const outcome = await resolveWorkspaceToken();
  if (outcome.kind === "ok") return outcome.accessToken;
  if (outcome.kind === "not-connected") failNotConnected();
  fail(`gws: could not obtain a Google Workspace token: ${outcome.detail}`);
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
export async function runGwsMediator(args: string[], binPath: string): Promise<number> {
  const approved = isApprovedGwsArgs(args, loadGwsAllowlist());
  if (!approved.ok) fail(`gws: ${approved.reason}`);

  const token = await resolveToken();
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

async function main(): Promise<void> {
  process.exitCode = await runGwsMediator(process.argv.slice(2), GWS_BIN_PATH);
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "gws: failed"}\n`);
    process.exitCode = 1;
  });
}
