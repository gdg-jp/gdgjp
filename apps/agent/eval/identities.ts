import type { Asker } from "./cases";

export const EVAL_CHAPTER = "e2e-chapter";

export function evalHeader(asker: Asker): string {
  return asker === "guest" ? "guest" : `${asker}:${EVAL_CHAPTER}`;
}
