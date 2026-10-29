import { expect, it } from "vitest";
import { formatDrawTime } from "./result";

it("formats the draw time in Japan time", () => {
  // 2026-10-30T05:32:00Z is 14:32 in Tokyo.
  expect(formatDrawTime(Date.UTC(2026, 9, 30, 5, 32) / 1000)).toBe("10/30 14:32");
  expect(formatDrawTime(Date.UTC(2026, 0, 1, 15, 5) / 1000)).toBe("1/2 00:05");
});
