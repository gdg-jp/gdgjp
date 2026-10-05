import { describe, expect, it } from "vitest";
import { formatYen, parseYenInput, sumAmounts } from "./money";

describe("sumAmounts", () => {
  it("sums to the yen", () => {
    expect(sumAmounts([4081, 3080, 12960])).toBe(20121);
  });
});

describe("parseYenInput", () => {
  it("accepts formatted yen strings", () => {
    expect(parseYenInput("¥12,960")).toBe(12960);
    expect(parseYenInput("abc")).toBeNull();
  });
});

describe("formatYen", () => {
  it("formats with yen symbol", () => {
    expect(formatYen(53860)).toBe("¥53,860");
  });
});
