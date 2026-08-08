import { describe, expect, it } from "vitest";
import { isRetryableFetchError } from "./fetch-source";

describe("isRetryableFetchError", () => {
  it("does not retry failures a retry can never fix", () => {
    // These would otherwise cycle error → fetching → error through the whole
    // retry budget while the source is broken for a reason no retry addresses.
    expect(isRetryableFetchError(new Error("Google Drive is not connected"))).toBe(false);
    expect(isRetryableFetchError(new Error("Unsupported Google Workspace URL"))).toBe(false);
    expect(isRetryableFetchError(new Error("Unsupported source kind: upload"))).toBe(false);
    expect(isRetryableFetchError(new Error("Google Docs returned an invalid image type"))).toBe(
      false,
    );
    expect(isRetryableFetchError(new Error("A Google Docs image exceeds the 10 MB limit"))).toBe(
      false,
    );
  });

  it("does not retry 4xx responses from Google", () => {
    expect(
      isRetryableFetchError(new Error("Google Docs document retrieval failed (404): not found")),
    ).toBe(false);
    expect(
      isRetryableFetchError(new Error("Google Drive text export failed (403): forbidden")),
    ).toBe(false);
  });

  it("retries throttling and server-side failures", () => {
    expect(isRetryableFetchError(new Error("Google Docs retrieval failed (429): slow down"))).toBe(
      true,
    );
    expect(
      isRetryableFetchError(new Error("Google Docs retrieval failed (503): unavailable")),
    ).toBe(true);
    expect(isRetryableFetchError(new Error("Google Docs retrieval failed (408): timeout"))).toBe(
      true,
    );
  });

  it("retries anything it cannot classify, since a spare retry is cheaper than a lost fetch", () => {
    expect(isRetryableFetchError(new Error("Network connection lost"))).toBe(true);
    expect(isRetryableFetchError("something odd")).toBe(true);
  });
});
