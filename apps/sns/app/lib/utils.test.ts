import { describe, expect, it } from "vitest";
import { chapterName } from "./utils";

describe("chapterName", () => {
  it("formats chapter slugs", () => {
    expect(chapterName("gdg-tokyo")).toBe("Tokyo");
  });
});
