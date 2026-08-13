import { describe, expect, it } from "vitest";
import { formatUserCode } from "./user-code";

describe("formatUserCode", () => {
  it("normalizes case and dashes to the canonical XXXX-XXXX display form", () => {
    expect(formatUserCode("abcd1234")).toBe("ABCD-1234");
    expect(formatUserCode("ABCD-1234")).toBe("ABCD-1234");
    expect(formatUserCode("aB cD-12 34")).toBe("ABCD-1234");
  });

  it("leaves a short or partial code without a dash", () => {
    expect(formatUserCode("ABCD")).toBe("ABCD");
    expect(formatUserCode("")).toBe("");
  });
});
