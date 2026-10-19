import { describe, expect, it } from "vitest";
import { latestOpenCue } from "./cues";
import type { Message } from "./protocol";
import { formatRemaining } from "./timer";

describe("formatRemaining", () => {
  it("rounds up while counting down and shows overrun with +", () => {
    expect(formatRemaining(20 * 60_000)).toBe("20:00");
    expect(formatRemaining(59_001)).toBe("01:00");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-83_000)).toBe("+01:23");
  });
});

describe("latestOpenCue", () => {
  const msg = (id: string, kind: Message["kind"]): Message => ({
    id,
    kind,
    from: { id: "op", name: "Ops", role: "operator" },
    to: null,
    text: id,
    at: 0,
  });

  it("returns the newest cue unless it was dismissed", () => {
    const list = [msg("c1", "cue"), msg("chat", "chat"), msg("c2", "cue"), msg("chat2", "chat")];
    expect(latestOpenCue(list, new Set())?.id).toBe("c2");
    // Dismissing the newest cue does not resurrect an older one.
    expect(latestOpenCue(list, new Set(["c2"]))).toBeNull();
    expect(latestOpenCue([msg("chat", "chat")], new Set())).toBeNull();
  });
});
