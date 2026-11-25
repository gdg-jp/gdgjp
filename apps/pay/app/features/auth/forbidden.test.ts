import { UNSAFE_ErrorResponseImpl } from "react-router";
import { describe, expect, it } from "vitest";
import { forbidden, forbiddenReason } from "./forbidden";

describe("forbidden", () => {
  it("answers 403 with the reason as JSON", async () => {
    const response = forbidden("no-chapter");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ reason: "no-chapter" });
  });

  it("reads the reason back from a route error", () => {
    expect(forbiddenReason(new UNSAFE_ErrorResponseImpl(403, "", { reason: "no-chapter" }))).toBe(
      "no-chapter",
    );
  });

  it("ignores other statuses, unknown reasons, and plain-text bodies", () => {
    expect(forbiddenReason(new UNSAFE_ErrorResponseImpl(404, "", { reason: "no-chapter" }))).toBe(
      null,
    );
    expect(forbiddenReason(new UNSAFE_ErrorResponseImpl(403, "", { reason: "toString" }))).toBe(
      null,
    );
    expect(forbiddenReason(new UNSAFE_ErrorResponseImpl(403, "", "Forbidden"))).toBe(null);
    expect(forbiddenReason(new Error("boom"))).toBe(null);
  });
});
