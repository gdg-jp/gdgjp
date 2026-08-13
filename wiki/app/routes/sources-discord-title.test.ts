import { describe, expect, it } from "vitest";
import { buildDiscordSourceTitle } from "./sources";

describe("buildDiscordSourceTitle", () => {
  it("includes the category segment when a category name is present", () => {
    expect(buildDiscordSourceTitle("Server", "Category", "general")).toBe(
      "Server-Category#general",
    );
  });

  it("omits the category segment when the channel is uncategorized", () => {
    expect(buildDiscordSourceTitle("Server", null, "general")).toBe("Server#general");
  });
});
