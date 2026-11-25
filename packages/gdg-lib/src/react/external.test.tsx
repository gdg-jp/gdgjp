import { act } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "../testing/render-hook";
import { useEventListener } from "./event-listener";
import { useClientValue, useHydrated, useMediaQuery, useValueChange } from "./external";
import { useMountEffect } from "./mount-effect";

function ServerProbe() {
  const hydrated = useHydrated();
  const client = useClientValue(() => "client", "server");
  const dark = useMediaQuery("(prefers-color-scheme: dark)", true);
  return <p>{`${hydrated}:${client}:${dark}`}</p>;
}

describe("server snapshots", () => {
  it("render the server values without touching browser APIs", () => {
    expect(renderToString(<ServerProbe />)).toContain("false:server:true");
  });
});

describe("useHydrated and useClientValue", () => {
  it("return client values after mounting", () => {
    const hook = renderHook(() => [useHydrated(), useClientValue(() => 7, 0)] as const, undefined);
    expect(hook.result.current).toEqual([true, 7]);
    hook.unmount();
  });
});

describe("useMediaQuery", () => {
  it("follows change events from matchMedia", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const matchMedia = vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    const hook = renderHook(() => useMediaQuery("(min-width: 600px)"), undefined);
    expect(hook.result.current).toBe(false);
    matches = true;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(hook.result.current).toBe(true);
    hook.unmount();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("useEventListener", () => {
  it("attaches the latest listener to window and detaches on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ listener }) => useEventListener("window", "resize", listener), {
      listener: first,
    });
    window.dispatchEvent(new Event("resize"));
    hook.rerender({ listener: second });
    window.dispatchEvent(new Event("resize"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    hook.unmount();
    window.dispatchEvent(new Event("resize"));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reads element targets from a ref and ignores null targets", () => {
    const element = document.createElement("button");
    const listener = vi.fn();
    const hook = renderHook(({ target }) => useEventListener(target, "click", listener), {
      target: { current: element } as { current: HTMLButtonElement | null } | null,
    });
    element.click();
    expect(listener).toHaveBeenCalledTimes(1);
    hook.rerender({ target: null });
    element.click();
    expect(listener).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});

describe("useValueChange", () => {
  it("reports each new value once, not the initial value", () => {
    const onChange = vi.fn();
    const hook = renderHook(({ value }) => useValueChange(value, onChange), {
      value: undefined as { ok: boolean } | undefined,
    });
    expect(onChange).not.toHaveBeenCalled();
    const data = { ok: true };
    hook.rerender({ value: data });
    hook.rerender({ value: data });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(data, undefined);
    hook.unmount();
  });
});

describe("useMountEffect", () => {
  it("runs once per mount and cleans up on unmount", () => {
    const cleanup = vi.fn();
    const effect = vi.fn((_value: number) => cleanup);
    const hook = renderHook(({ value }) => useMountEffect(() => effect(value)), { value: 1 });
    hook.rerender({ value: 2 });
    expect(effect).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
