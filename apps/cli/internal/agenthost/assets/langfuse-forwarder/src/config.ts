import { readFileSync } from "node:fs";

/**
 * Credentials file shape at LANGFUSE_CREDENTIALS_PATH (default
 * /home/gdgagent-svc/.config/langfuse/credentials.json, 0600, gdgagent-svc-owned).
 *
 * `idSalt` is not in the original plan's field list (which only named the three
 * LANGFUSE_* fields) but hashing userId/sessionId needs a salt somewhere, and this
 * file is already the right shape for it (same trust boundary as the API keys).
 */
export interface LangfuseCredentials {
  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_SECRET_KEY: string;
  /** Defaults to the JP region per docs/agents-observability.md's hosting decision. */
  LANGFUSE_HOST: string;
  /** HMAC salt for hashing appSessionId before it becomes a Langfuse userId/sessionId. */
  idSalt: string;
}

export interface ForwarderConfig extends LangfuseCredentials {
  /** xangi's DATA_DIR — logs/observability/*.jsonl lives under here. */
  dataDir: string;
  /** Where the forwarder keeps its idempotency state and quarantine dead-letters. */
  stateDir: string;
}

const DEFAULT_LANGFUSE_HOST = "https://jp.cloud.langfuse.com";
const REQUIRED_CREDENTIAL_FIELDS = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "idSalt",
] as const;

function readCredentials(path: string): LangfuseCredentials {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `langfuse-forwarder: cannot read credentials file at ${path}. ` +
        `Create it (0600, gdgagent-svc-owned) with LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, idSalt. (${err})`,
    );
  }

  let parsed: Partial<LangfuseCredentials>;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`langfuse-forwarder: ${path} is not valid JSON. (${err})`);
  }

  for (const field of REQUIRED_CREDENTIAL_FIELDS) {
    if (!parsed[field] || typeof parsed[field] !== "string" || !(parsed[field] as string).trim()) {
      throw new Error(`langfuse-forwarder: ${path} is missing required field "${field}".`);
    }
  }

  return {
    LANGFUSE_PUBLIC_KEY: parsed.LANGFUSE_PUBLIC_KEY as string,
    LANGFUSE_SECRET_KEY: parsed.LANGFUSE_SECRET_KEY as string,
    LANGFUSE_HOST: parsed.LANGFUSE_HOST?.trim() || DEFAULT_LANGFUSE_HOST,
    idSalt: parsed.idSalt as string,
  };
}

/**
 * Fails loudly at startup if config is missing, same as xangi's
 * start_xangi_service() gates on DISCORD_TOKEN — a forwarder run with no
 * credentials should error, not silently no-op.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ForwarderConfig {
  const credentialsPath =
    env.LANGFUSE_CREDENTIALS_PATH || "/home/gdgagent-svc/.config/langfuse/credentials.json";
  const dataDir = env.DATA_DIR;
  const stateDir =
    env.LANGFUSE_FORWARDER_STATE_DIR || "/home/gdgagent-svc/.local/share/langfuse-forwarder";

  if (!dataDir) {
    throw new Error("langfuse-forwarder: DATA_DIR env var is required (xangi's data directory).");
  }

  const credentials = readCredentials(credentialsPath);
  return { ...credentials, dataDir, stateDir };
}
