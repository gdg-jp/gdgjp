import { describe, expect, it } from "vitest";
import { STAGE_ID_RE, WORDS, generateStageId, isStageId } from "./stage-id";

describe("stage ids", () => {
  it("draws three distinct lowercase words", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateStageId();
      expect(id).toMatch(STAGE_ID_RE);
      expect(new Set(id.split("-")).size).toBe(3);
    }
  });

  it("re-draws a repeated word", () => {
    const picks = [0, 0, 1, 2];
    expect(generateStageId(() => picks.shift() ?? 3)).toBe(`${WORDS[0]}-${WORDS[1]}-${WORDS[2]}`);
  });

  it("has a large, clean word list", () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
    expect(WORDS.length).toBeGreaterThanOrEqual(500);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/);
  });

  it("validates ids", () => {
    expect(isStageId("apple-banana-orange")).toBe(true);
    expect(isStageId("Apple-banana-orange")).toBe(false);
    expect(isStageId("apple-banana")).toBe(false);
    expect(isStageId("../etc")).toBe(false);
    expect(isStageId(undefined)).toBe(false);
  });
});
