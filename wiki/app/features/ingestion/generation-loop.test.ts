import { describe, expect, it } from "vitest";
import { GENERATION_EXPLORATION_STEP_LIMIT, prepareExplorationStep } from "./generation-loop";

describe("prepareExplorationStep", () => {
  it("forces the first exploration call to read the source", () => {
    expect(prepareExplorationStep(0)).toEqual({
      activeTools: ["cat"],
      toolChoice: { type: "tool", toolName: "cat" },
    });
  });

  it("uses automatic bounded exploration after the source read", () => {
    expect(prepareExplorationStep(1)).toBeUndefined();
    expect(GENERATION_EXPLORATION_STEP_LIMIT).toBe(11);
  });
});
