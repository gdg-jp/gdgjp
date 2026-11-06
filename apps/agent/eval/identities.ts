import type { Asker } from "./cases";

/** The synthetic chapter the e2e fixtures grant (docs/eval/fixtures/setup.sql). */
export const EVAL_CHAPTER = "e2e-chapter";

/**
 * Asker → `x-agent-eval-as`. The wiki accepts it only with AGENT_SERVICE_TOKEN and only
 * inside e2e spaces; `guest` is an unlinked Discord user (public pages only).
 */
export function evalHeader(asker: Asker): string {
  return asker === "guest" ? "guest" : `${asker}:${EVAL_CHAPTER}`;
}
