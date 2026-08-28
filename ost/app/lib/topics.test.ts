import { describe, expect, it } from "vitest";
import { MAX_TOPIC_LENGTH, normalizeTopicText } from "./topics";

describe("normalizeTopicText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTopicText("  How to run OST  ")).toBe("How to run OST");
  });

  it("collapses internal whitespace and newlines", () => {
    expect(normalizeTopicText("line one\n\n   line two")).toBe("line one line two");
  });

  it("rejects non-string input", () => {
    expect(normalizeTopicText(undefined)).toBeNull();
    expect(normalizeTopicText(null)).toBeNull();
    expect(normalizeTopicText(42)).toBeNull();
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeTopicText("")).toBeNull();
    expect(normalizeTopicText("     ")).toBeNull();
    expect(normalizeTopicText("\n\t")).toBeNull();
  });

  it("accepts a topic exactly at the length limit", () => {
    const atLimit = "a".repeat(MAX_TOPIC_LENGTH);
    expect(normalizeTopicText(atLimit)).toBe(atLimit);
  });

  it("rejects a topic longer than the limit", () => {
    expect(normalizeTopicText("a".repeat(MAX_TOPIC_LENGTH + 1))).toBeNull();
  });
});
