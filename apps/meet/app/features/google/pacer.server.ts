import { delay } from "@gdgjp/gdg-lib/timing";

export const STATS_MIN_INTERVAL_MS = 200;

export const STATS_MAX_CALLS_PER_JOB = 100;

export type PacerOptions = {
  minIntervalMs: number;
  maxCalls: number;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type ApiPacer = {
  next: () => Promise<boolean>;
  usedCalls: () => number;
};

export function createPacer(options: PacerOptions): ApiPacer {
  const nowMs = options.nowMs ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const minIntervalMs = Math.max(0, options.minIntervalMs);
  const maxCalls = Math.max(0, Math.floor(options.maxCalls));

  let calls = 0;
  let lastCallMs = 0;

  return {
    async next(): Promise<boolean> {
      if (calls >= maxCalls) {
        return false;
      }
      if (calls > 0 && minIntervalMs > 0) {
        const elapsed = nowMs() - lastCallMs;
        if (elapsed < minIntervalMs) {
          await sleep(minIntervalMs - elapsed);
        }
      }
      lastCallMs = nowMs();
      calls += 1;
      return true;
    },
    usedCalls: () => calls,
  };
}
