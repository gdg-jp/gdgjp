import { describe, expect, it } from "vitest";
import { chapterName, isValidEmail, safeReturnTo } from "./utils";

describe("SNS utilities", () => {
  it("only permits same-origin return paths", () => {
    expect(safeReturnTo("/schedule?edit=post-1")).toBe("/schedule?edit=post-1");
    expect(safeReturnTo("https://example.com")).toBe("/posts");
    expect(safeReturnTo("//example.com")).toBe("/posts");
  });

  it("formats chapter slugs and validates contributor emails", () => {
    expect(chapterName("gdg-tokyo")).toBe("Tokyo");
    expect(isValidEmail("organizer@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });
});
