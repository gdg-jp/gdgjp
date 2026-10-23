import { describe, expect, it } from "vitest";
import { type DeckLayout, type Key, emptyLayout } from "~/features/deck/model";
import { resolvePress } from "./press";

function deck(keys: Key[]): DeckLayout {
  const layout = emptyLayout(4, 1);
  const page = layout.boards.root?.pages[0];
  if (!page) throw new Error("no page");
  keys.forEach((k, i) => {
    page.keys[String(i)] = k;
  });
  return layout;
}

const base = {
  title: "",
  look: { icon: null, image: null, color: "neutral" as const },
  lookOn: null,
  confirm: { mode: "none" as const },
};

const stream: Key = {
  ...base,
  id: "stream",
  behavior: { type: "action", action: { op: "stream", mode: "toggle" } },
};
const ptt: Key = {
  ...base,
  id: "ptt",
  behavior: {
    type: "action",
    action: { op: "mute", input: { name: "Mic", uuid: null }, mode: "pushToTalk" },
  },
};
const sw: Key = {
  ...base,
  id: "sw",
  behavior: {
    type: "multiSwitch",
    a: [{ type: "obs", action: { op: "record", mode: "on" } }],
    b: [{ type: "obs", action: { op: "record", mode: "off" } }],
  },
};
const slider: Key = {
  ...base,
  id: "vol",
  behavior: {
    type: "action",
    action: { op: "volume", input: { name: "Mic", uuid: null }, mode: "slider", db: 0 },
  },
};

describe("resolvePress", () => {
  const layout = deck([stream, ptt, sw, slider]);

  it("runs a key's action and refuses unknown keys", () => {
    const res = resolvePress(layout, {}, { type: "press", keyId: "stream", phase: "press" });
    expect(res.ok && res.run.steps).toEqual([
      { type: "obs", action: { op: "stream", mode: "toggle" } },
    ]);
    expect(resolvePress(layout, {}, { type: "press", keyId: "ghost", phase: "press" }).ok).toBe(
      false,
    );
  });

  it("sends push-to-talk on down/up only", () => {
    expect(resolvePress(layout, {}, { type: "press", keyId: "ptt", phase: "down" }).ok).toBe(true);
    expect(resolvePress(layout, {}, { type: "press", keyId: "ptt", phase: "press" }).ok).toBe(
      false,
    );
    expect(resolvePress(layout, {}, { type: "press", keyId: "stream", phase: "up" })).toEqual({
      ok: false,
      error: "ignored",
    });
  });

  it("alternates multi-action switches", () => {
    const first = resolvePress(layout, {}, { type: "press", keyId: "sw", phase: "press" });
    if (!first.ok) throw new Error("expected ok");
    expect(first.run.steps[0]).toEqual({ type: "obs", action: { op: "record", mode: "on" } });
    const second = resolvePress(layout, first.run.switches, {
      type: "press",
      keyId: "sw",
      phase: "press",
    });
    if (!second.ok) throw new Error("expected ok");
    expect(second.run.steps[0]).toEqual({ type: "obs", action: { op: "record", mode: "off" } });
    expect(second.run.switches.sw).toBe(false);
  });

  it("accepts slider values only for slider keys, clamped", () => {
    const res = resolvePress(layout, {}, { type: "volume", keyId: "vol", db: 12 });
    expect(res.ok && res.run.value).toBe(0);
    expect(resolvePress(layout, {}, { type: "volume", keyId: "stream", db: -5 }).ok).toBe(false);
  });
});
