import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { delay } from "./timing";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("delay", () => {
  it("resolves after the delay", async () => {
    const settled = vi.fn();
    const pending = delay(100).then(settled);
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("rejects with the abort reason and clears the timer", async () => {
    const controller = new AbortController();
    const pending = delay(1000, controller.signal);
    controller.abort(new Error("stopped"));
    await expect(pending).rejects.toThrow("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    await expect(delay(10, AbortSignal.abort(new Error("gone")))).rejects.toThrow("gone");
  });
});
