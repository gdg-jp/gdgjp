import { expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

it("only permits same-origin return paths", () => {
  expect(safeReturnTo("/schedule?edit=post-1")).toBe("/schedule?edit=post-1");
  expect(safeReturnTo("https://example.com")).toBe("/posts");
  expect(safeReturnTo("//example.com")).toBe("/posts");
});
