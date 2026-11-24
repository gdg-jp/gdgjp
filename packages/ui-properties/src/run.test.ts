import { describe, expect, it } from "vitest";
import { encodeReplay } from "./engine";
import { parseAriaSnapshot } from "./monitor";
import { replayCommands, runPlan } from "./run";

describe("runPlan", () => {
  const defaults = { seeds: [1701, 9127], steps: 80 };

  it("uses the fixed seeds and the short budget on pull requests", () => {
    expect(runPlan(defaults, {})).toMatchObject({
      profile: "pr",
      seeds: [1701, 9127],
      steps: 80,
      shrinkReplays: 10,
      replay: null,
    });
  });

  it("adds dated seeds and a longer budget in the long profile", () => {
    const day = new Date("2026-11-24T00:00:00Z");
    const plan = runPlan(defaults, { UI_PROPERTY_PROFILE: "long" }, day);
    expect(plan.seeds).toHaveLength(6);
    expect(plan.seeds.slice(0, 2)).toEqual([1701, 9127]);
    expect(runPlan(defaults, { UI_PROPERTY_PROFILE: "long" }, day).seeds).toEqual(plan.seeds);
    expect(plan.steps).toBe(400);
  });

  it("accepts explicit seeds, steps, and replays", () => {
    const replay = encodeReplay([{ action: "reload", input: null }]);
    const plan = runPlan(defaults, {
      UI_PROPERTY_SEEDS: "5, 6",
      UI_PROPERTY_STEPS: "12",
      UI_PROPERTY_REPLAY: replay,
    });
    expect(plan).toMatchObject({ seeds: [5, 6], steps: 12 });
    expect(plan.replay).toEqual([{ action: "reload", input: null }]);
  });

  it("rejects malformed configuration", () => {
    expect(() => runPlan(defaults, { UI_PROPERTY_PROFILE: "nightly" })).toThrow();
    expect(() => runPlan(defaults, { UI_PROPERTY_SEEDS: "x" })).toThrow();
    expect(() => runPlan(defaults, { UI_PROPERTY_STEPS: "0" })).toThrow();
  });
});

describe("replayCommands", () => {
  it("names the workspace, spec, test, seed and replay", () => {
    const commands = replayCommands({
      workspace: "@gdgjp/wiki",
      spec: "tests/e2e/ui-properties.spec.ts",
      title: "seed 1701 desktop (1440x1000)",
      seed: 1701,
      steps: 37,
      profile: "pr",
      replay: "abc",
    });
    expect(commands.seed).toBe(
      "UI_PROPERTY_PROFILE=pr UI_PROPERTY_SEEDS=1701 UI_PROPERTY_STEPS=37 pnpm test:e2e --workspace @gdgjp/wiki -- tests/e2e/ui-properties.spec.ts -g ' seed 1701 desktop \\(1440x1000\\)$'",
    );
    expect(commands.minimal).toContain("UI_PROPERTY_SEEDS=1701 UI_PROPERTY_REPLAY=abc ");
  });
});

describe("parseAriaSnapshot", () => {
  it("reads the role and accessible name", () => {
    expect(parseAriaSnapshot('- button "Share"')).toEqual({ role: "button", name: "Share" });
    expect(parseAriaSnapshot('- textbox "Title": hello')).toEqual({
      role: "textbox",
      name: "Title",
    });
    expect(parseAriaSnapshot('- link "Say \\"hi\\"":\n  - /url: /x')).toEqual({
      role: "link",
      name: 'Say "hi"',
    });
    expect(parseAriaSnapshot("- button")).toEqual({ role: "button", name: "" });
    expect(parseAriaSnapshot("")).toBeNull();
  });
});
