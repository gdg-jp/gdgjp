import { describe, expect, it } from "vitest";
import { validateFolderName } from "./name";

describe("validateFolderName", () => {
  it("trims surrounding whitespace", () => {
    expect(validateFolderName("  logos  ")).toEqual({ ok: true, name: "logos" });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateFolderName("")).toEqual({ ok: false });
    expect(validateFolderName("   ")).toEqual({ ok: false });
  });

  it("rejects a name over 48 characters", () => {
    expect(validateFolderName("a".repeat(49))).toEqual({ ok: false });
  });

  it("accepts a name at exactly 48 characters", () => {
    const name = "a".repeat(48);
    expect(validateFolderName(name)).toEqual({ ok: true, name });
  });
});
