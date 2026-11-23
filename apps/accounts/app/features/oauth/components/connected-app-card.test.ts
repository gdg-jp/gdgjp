import { describe, expect, it } from "vitest";
import { formatConnectedAt } from "./connected-app-card";

describe("formatConnectedAt", () => {
  it("renders the same Japan time on the server and in any browser time zone", () => {
    const value = "2026-11-23T15:00:00.000Z";
    const tokyo = new Intl.DateTimeFormat("ja", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(new Date(value));
    const utc = new Intl.DateTimeFormat("ja", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));

    expect(formatConnectedAt(value, "ja")).toBe(tokyo);
    expect(formatConnectedAt(value, "ja")).not.toBe(utc);
    expect(formatConnectedAt(value, "ja")).toContain("2026/11/24");
  });
});
