import { describe, expect, it } from "vitest";
import { STATUSES, canApply, isEventStatus } from "./status";

describe("canApply", () => {
  it.each(STATUSES)("status=%s", (status) => {
    expect(canApply(status)).toBe(status === "open");
  });
});

describe("isEventStatus", () => {
  it("accepts every known status", () => {
    for (const status of STATUSES) expect(isEventStatus(status)).toBe(true);
  });

  it("rejects unknown strings", () => {
    expect(isEventStatus("archived")).toBe(false);
    expect(isEventStatus("")).toBe(false);
    expect(isEventStatus("Draft")).toBe(false);
  });
});
