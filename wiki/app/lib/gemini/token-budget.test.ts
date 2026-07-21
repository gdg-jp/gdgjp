import { describe, expect, it } from "vitest";
import {
  SourceContextTooLargeError,
  getAvailableInputTokens,
  selectWithinTokenBudget,
} from "./token-budget";

describe("getAvailableInputTokens", () => {
  it("reserves output tokens and a 10% safety margin", () => {
    expect(
      getAvailableInputTokens({
        contextWindowTokens: 1_000,
        outputReserveTokens: 200,
      }),
    ).toBe(700);
  });

  it("rejects invalid safety margins", () => {
    expect(() =>
      getAvailableInputTokens({
        contextWindowTokens: 1_000,
        outputReserveTokens: 100,
        safetyMargin: 1,
      }),
    ).toThrow("safetyMargin");
  });
});

describe("selectWithinTokenBudget", () => {
  const budget = { contextWindowTokens: 1_000, outputReserveTokens: 100, safetyMargin: 0 };

  it("keeps ranked evidence in order and omits only items that do not fit", () => {
    const result = selectWithinTokenBudget(
      [
        { id: "best", tokens: 400 },
        { id: "too-large", tokens: 500 },
        { id: "fits-after-skip", tokens: 300 },
      ],
      (item) => item.tokens,
      100,
      budget,
    );

    expect(result.selected.map((item) => item.id)).toEqual(["best", "fits-after-skip"]);
    expect(result.omitted.map((item) => item.id)).toEqual(["too-large"]);
    expect(result.usedTokens).toBe(800);
  });

  it("reports a source-only overflow distinctly from optional evidence overflow", () => {
    expect(() => selectWithinTokenBudget([], () => 0, 901, budget)).toThrow(
      SourceContextTooLargeError,
    );
    try {
      selectWithinTokenBudget([], () => 0, 901, budget);
    } catch (error) {
      expect(error).toMatchObject({ code: "source_context_too_large" });
    }
  });
});
