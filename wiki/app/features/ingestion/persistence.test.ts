import { describe, expect, it } from "vitest";
import { isIngestionProviderError } from "./persistence.server";

describe("isIngestionProviderError", () => {
  it("recognizes Gemini quota and rate-limit failures", () => {
    expect(
      isIngestionProviderError(
        "Quota exceeded for generativelanguage.googleapis.com, model: gemini-3.1-flash-lite",
      ),
    ).toBe(true);
    expect(isIngestionProviderError("Google API request failed with status 429")).toBe(true);
  });

  it("does not expose unrelated internal failures", () => {
    expect(isIngestionProviderError("Unexpected database invariant")).toBe(false);
  });
});
