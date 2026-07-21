import { describe, expect, it } from "vitest";
import { GEMINI_MODEL, PROMPT_VERSIONS } from "./prompts";

describe("generation prompt metadata", () => {
  it("assigns a stable version to every provider operation", () => {
    expect(GEMINI_MODEL).toBe("gemini-3-flash-preview");
    expect(Object.values(PROMPT_VERSIONS)).toHaveLength(7);
    expect(new Set(Object.values(PROMPT_VERSIONS)).size).toBe(7);
  });
});
