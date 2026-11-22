/** 統計ジョブ用の API 呼び出し最小間隔（600 reads/min 上限の半分 = 最大 300 reads/min）。 */
export const STATS_MIN_INTERVAL_MS = 200;

/** 1 回の Queue ジョブ実行で許可する Google API 呼び出し上限。 */
export const STATS_MAX_CALLS_PER_JOB = 100;

export type PacerOptions = {
  minIntervalMs: number;
  maxCalls: number;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type ApiPacer = {
  /** 次の API 呼び出しが予算内なら必要な待機後に `true`、上限到達時は待機せず `false` を返す。 */
  next: () => Promise<boolean>;
  /** これまでに消費した呼び出し回数を返す。 */
  usedCalls: () => number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Google API 呼び出しの間隔と 1 ジョブあたりの呼び出し上限を制御するペーサーを生成する。
 */
export function createPacer(options: PacerOptions): ApiPacer {
  const nowMs = options.nowMs ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
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
