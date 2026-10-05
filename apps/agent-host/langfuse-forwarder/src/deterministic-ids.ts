import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import type { IdGenerator } from "@opentelemetry/sdk-trace-base";

/**
 * Deterministic trace/span IDs derived from xangi's own turnId/toolCallId.
 *
 * This is what actually makes forwarding idempotent. Without it, every
 * startObservation() call gets a fresh random trace_id/observation_id from
 * the OTel SDK, so a crash after a successful forceFlush() but before
 * saveState() (or a corrupt-state-file fallback to `{ forwarded: {} }` in
 * state.ts) would re-send the same turn under BRAND NEW ids — creating a
 * genuine duplicate trace in Langfuse, not a harmless re-send. Langfuse's
 * ingestion upserts by (trace_id, observation_id), so re-forwarding a turn
 * under the SAME derived ids is a true no-op on the Langfuse side.
 *
 * Wire this in as NodeSDK's `idGenerator` (see index.ts), then wrap every
 * startObservation() call for one logical span in withDeterministicIds(seed, ...)
 * — the seed should be turnId for the root agent observation, and
 * `${turnId}:${toolCallId}` for each tool span.
 */

const seedStorage = new AsyncLocalStorage<string>();

function hashHex(seed: string, byteLen: number): string {
  return createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, byteLen * 2);
}

export const deterministicIdGenerator: IdGenerator = {
  generateTraceId(): string {
    const seed = seedStorage.getStore();
    return seed ? hashHex(`trace:${seed}`, 16) : randomBytes(16).toString("hex");
  },
  generateSpanId(): string {
    const seed = seedStorage.getStore();
    return seed ? hashHex(`span:${seed}`, 8) : randomBytes(8).toString("hex");
  },
};

/** Runs fn with a fixed id seed active, so any span created inside gets deterministic ids. */
export function withDeterministicIds<T>(seed: string, fn: () => T): T {
  return seedStorage.run(seed, fn);
}
