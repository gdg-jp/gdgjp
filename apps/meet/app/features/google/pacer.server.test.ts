import { describe, expect, it, vi } from "vitest";
import { STATS_MAX_CALLS_PER_JOB, STATS_MIN_INTERVAL_MS, createPacer } from "./pacer.server";

describe("createPacer", () => {
  it("統計ジョブ用の定数が 300 reads/min 相当かつ 100 回上限である", () => {
    expect(STATS_MIN_INTERVAL_MS).toBe(200);
    expect(STATS_MAX_CALLS_PER_JOB).toBe(100);
  });

  it("初回呼び出しでは待機せず、2 回目以降は minIntervalMs を満たすよう待機し、maxCalls 到達で false を返す", async () => {
    let clock = 1000;
    const sleepCalls: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
      clock += ms;
    });

    const pacer = createPacer({
      minIntervalMs: 200,
      maxCalls: 3,
      nowMs: () => clock,
      sleep,
    });

    // 1 回目: 待機なし
    expect(await pacer.next()).toBe(true);
    expect(sleepCalls).toEqual([]);
    expect(pacer.usedCalls()).toBe(1);

    // 50ms 経過後に 2 回目 → 150ms 待機
    clock += 50;
    expect(await pacer.next()).toBe(true);
    expect(sleepCalls).toEqual([150]);
    expect(pacer.usedCalls()).toBe(2);

    // 250ms 経過後に 3 回目 → 待機なし
    clock += 250;
    expect(await pacer.next()).toBe(true);
    expect(sleepCalls).toEqual([150]);
    expect(pacer.usedCalls()).toBe(3);

    // 4 回目: 上限到達のため待機せず false を返す
    expect(await pacer.next()).toBe(false);
    expect(sleepCalls).toEqual([150]);
    expect(pacer.usedCalls()).toBe(3);
  });
});
