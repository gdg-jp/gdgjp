import { describe, expect, it } from "vitest";
import { GENERATION_EXPLORATION_STEP_LIMIT } from "./agent-loop";

describe("generation exploration", () => {
  it("keeps a model-step guard without forcing a redundant first tool call", () => {
    expect(GENERATION_EXPLORATION_STEP_LIMIT).toBe(8);
  });
});
