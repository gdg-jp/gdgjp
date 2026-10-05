import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Idempotency state: which turnIds have already been forwarded to Langfuse,
 * per appSessionId. Not a byte/line watermark — the source (xangi's
 * logs/observability/*.jsonl) is append-only with stable turnIds, so "have we
 * forwarded this turnId" is the right question, not "how many bytes have we
 * read". This is what lets a quarantined/malformed line simply never appear
 * here instead of needing special-cased skip logic.
 */
export interface ForwarderState {
  /** appSessionId -> turnId -> digest of the forwarded complete event set. */
  forwarded: Record<string, Record<string, string>>;
}

function statePath(stateDir: string): string {
  return join(stateDir, "state.json");
}

export function loadState(stateDir: string): ForwarderState {
  const path = statePath(stateDir);
  if (!existsSync(path)) {
    return { forwarded: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.forwarded &&
      typeof parsed.forwarded === "object"
    ) {
      const forwarded: Record<string, Record<string, string>> = {};
      for (const [session, value] of Object.entries(parsed.forwarded as Record<string, unknown>)) {
        // v1 state stored an array. Deliberately migrate it to an empty map so old
        // turns are safely upserted once with their deterministic v2 observations.
        forwarded[session] = Array.isArray(value) ? {} : (value as Record<string, string>);
      }
      return { forwarded };
    }
  } catch {
    // Corrupt state file — start clean rather than crash-loop the timer.
    // Worst case is re-forwarding turns already sent, which is safe: Langfuse
    // upserts by trace id, and our trace ids are deterministic from turnId.
  }
  return { forwarded: {} };
}

/** Atomic write via temp-file + rename, so a crash mid-write can't corrupt state.json. */
export function saveState(stateDir: string, state: ForwarderState): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const path = statePath(stateDir);
  const tmpPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmpPath, path);
}

export function isForwarded(
  state: ForwarderState,
  appSessionId: string,
  turnId: string,
  digest: string,
): boolean {
  return state.forwarded[appSessionId]?.[turnId] === digest;
}

export function markForwarded(
  state: ForwarderState,
  appSessionId: string,
  turnId: string,
  digest: string,
): void {
  state.forwarded[appSessionId] ??= {};
  state.forwarded[appSessionId][turnId] = digest;
}
