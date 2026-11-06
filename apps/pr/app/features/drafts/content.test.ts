import { describe, expect, it } from "vitest";
import { autoFold } from "./content";

describe("autoFold", () => {
  it("leaves short posts whole", () => {
    expect(autoFold("短い投稿")).toEqual({ textAboveFold: "短い投稿", textBelowFold: "" });
  });
  it("cuts a long post at the last line break before the fold", () => {
    const line = "あ".repeat(60);
    const text = `${line}\n${line}\n{{shortlink}}\n${line}\n${line}`;
    const { textAboveFold, textBelowFold } = autoFold(text);
    expect(textAboveFold + textBelowFold).toBe(text);
    expect(textAboveFold.endsWith("\n")).toBe(true);
    expect(textAboveFold).toContain("{{shortlink}}");
  });
});
