import { describe, expect, it } from "vitest";
import { campaignSourceUrl } from "./source-url";

describe("campaignSourceUrl", () => {
  it("normalizes and adds a source without changing the path", () => {
    expect(campaignSourceUrl("https://gdgs.jp/df26d", " Tokyo ")).toBe(
      "https://gdgs.jp/df26d?s=tokyo",
    );
  });

  it("replaces an existing source parameter", () => {
    expect(campaignSourceUrl("https://gdgs.jp/df26d?s=old", "server-a")).toBe(
      "https://gdgs.jp/df26d?s=server-a",
    );
  });

  it("rejects invalid source codes", () => {
    expect(campaignSourceUrl("https://gdgs.jp/df26d", "Tokyo event")).toBeNull();
    expect(campaignSourceUrl("https://gdgs.jp/df26d", "?osaka")).toBeNull();
  });
});
