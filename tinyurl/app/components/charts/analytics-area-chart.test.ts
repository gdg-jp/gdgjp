import { describe, expect, it } from "vitest";
import { formatAnalyticsTick } from "./analytics-area-chart";

describe("formatAnalyticsTick", () => {
  it("treats Analytics Engine offset-less buckets as UTC and displays them in the viewer timezone", () => {
    const label = formatAnalyticsTick("2026-07-31 00:00:00", "hour", "Asia/Tokyo");

    expect(label).toMatch(/09/);
  });
});
