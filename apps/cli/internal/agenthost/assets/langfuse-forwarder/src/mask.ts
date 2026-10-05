import { createHmac } from "node:crypto";

/**
 * Masking backstop, ported from `agents/lib/langfuse.ts` (the sibling Vercel app's
 * Langfuse integration — see docs/agents-observability.md). This does NOT replace
 * the "full content, no masking" decision for conversation/tool data — it only
 * catches credentials that should never have been in that content in the first
 * place (Bearer tokens, JWTs, exact matches of secrets this process happens to
 * know about).
 *
 * Unlike the Vercel app (which runs in the same process as the secrets it might
 * leak, so it can read them from process.env), the forwarder runs as a separate
 * systemd unit from xangi and loads its one configured secret
 * (LANGFUSE_SECRET_KEY) from a JSON credentials file, not env — the systemd unit
 * never exports it as an environment variable. So exact-match secrets must be
 * passed in explicitly by the caller (index.ts, from ForwarderConfig) rather
 * than read from process.env here; a process.env-based default would silently
 * never match anything in production. The Bearer/JWT pattern match below needs
 * no such wiring and is what catches most real leaks (e.g. a token pasted into
 * a wiki page or a tool result) regardless of which secret it is.
 */

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  redacted = redacted.replace(JWT_PATTERN, "[REDACTED]");
  for (const secret of secrets) {
    if (redacted.includes(secret)) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}

export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, secrets));
  }
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = redactValue(entry, secrets);
    }
    return redacted;
  }
  return value;
}

/**
 * Deep-walk redactor for a whole event payload before it's sent to Langfuse.
 * `secrets` must be passed explicitly — see the module doc comment above for
 * why a process.env-based default would silently redact nothing in production.
 */
export function maskEventData(data: unknown, secrets: readonly string[]): unknown {
  return redactValue(data, secrets);
}

/**
 * HMAC-SHA256 of a raw Discord/session id, truncated the same way as the sibling
 * app's TELEMETRY_ID_SALT convention (see docs/agents-observability.md). Never
 * send raw appSessionId/Discord ids to Langfuse.
 */
export function hashId(rawId: string, salt: string): string {
  return createHmac("sha256", salt).update(rawId).digest("hex").slice(0, 32);
}
