import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "../testing/render-hook";
import {
  useAnimationFrame,
  useDebouncedCallback,
  useDebouncedValue,
  useInterval,
  useNow,
  useTimeout,
  useTransientValue,
} from "./timers";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useInterval", () => {
  it("calls the latest callback every delay and stops on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ callback }) => useInterval(callback, 100), { callback: first });
    act(() => vi.advanceTimersByTime(250));
    expect(first).toHaveBeenCalledTimes(2);
    hook.rerender({ callback: second });
    act(() => vi.advanceTimersByTime(100));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
    hook.unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("pauses while the delay is null", () => {
    const callback = vi.fn();
    const hook = renderHook(({ delay }) => useInterval(callback, delay), {
      delay: null as number | null,
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(callback).not.toHaveBeenCalled();
    hook.rerender({ delay: 50 });
    act(() => vi.advanceTimersByTime(100));
    expect(callback).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
});

describe("useNow", () => {
  it("ticks with the clock", () => {
    vi.setSystemTime(1_000);
    const hook = renderHook(() => useNow(1000), undefined);
    expect(hook.result.current).toBe(1_000);
    act(() => vi.advanceTimersByTime(1000));
    expect(hook.result.current).toBe(2_000);
    hook.unmount();
  });
});

describe("useTimeout", () => {
  it("replaces the pending callback and cancels on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(() => useTimeout(), undefined);
    hook.result.current.start(first, 100);
    hook.result.current.start(second, 100);
    act(() => vi.advanceTimersByTime(100));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    hook.result.current.start(late, 100);
    hook.unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(late).not.toHaveBeenCalled();
  });
});

describe("useTransientValue", () => {
  it("shows a value for the duration and restarts on repeat", () => {
    const hook = renderHook(() => useTransientValue<string>(1000), undefined);
    expect(hook.result.current[0]).toBeNull();
    act(() => hook.result.current[1]("copied"));
    expect(hook.result.current[0]).toBe("copied");
    act(() => vi.advanceTimersByTime(600));
    act(() => hook.result.current[1]("again"));
    act(() => vi.advanceTimersByTime(600));
    expect(hook.result.current[0]).toBe("again");
    act(() => vi.advanceTimersByTime(400));
    expect(hook.result.current[0]).toBeNull();
    act(() => hook.result.current[1]("bye"));
    act(() => hook.result.current[2]());
    expect(hook.result.current[0]).toBeNull();
    hook.unmount();
  });
});

describe("useDebouncedValue", () => {
  it("publishes only after the value settles", () => {
    const hook = renderHook(({ value }) => useDebouncedValue(value, 300), { value: "a" });
    hook.rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(200));
    hook.rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(200));
    expect(hook.result.current).toBe("a");
    act(() => vi.advanceTimersByTime(100));
    expect(hook.result.current).toBe("abc");
    hook.unmount();
  });
});

describe("useDebouncedCallback", () => {
  it("runs the last call once, flushes, and cancels on unmount", () => {
    const callback = vi.fn();
    const hook = renderHook(() => useDebouncedCallback(callback, 100), undefined);
    hook.result.current.run(1);
    hook.result.current.run(2);
    act(() => vi.advanceTimersByTime(100));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(2);
    hook.result.current.run(3);
    hook.result.current.flush();
    expect(callback).toHaveBeenLastCalledWith(3);
    hook.result.current.run(4);
    hook.unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

describe("useAnimationFrame", () => {
  it("loops while active and stops when inactive", () => {
    const callback = vi.fn();
    const hook = renderHook(({ active }) => useAnimationFrame(callback, active), { active: true });
    act(() => vi.advanceTimersByTime(100));
    const calls = callback.mock.calls.length;
    expect(calls).toBeGreaterThan(2);
    hook.rerender({ active: false });
    act(() => vi.advanceTimersByTime(100));
    expect(callback.mock.calls.length).toBe(calls);
    hook.unmount();
  });
});
