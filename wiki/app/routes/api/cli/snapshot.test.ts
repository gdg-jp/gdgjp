import { describe, expect, it } from "vitest";
import { snapshotContentAsMarkdown } from "./snapshot";

describe("snapshotContentAsMarkdown", () => {
  it("does not expose legacy TipTap JSON to CLI clients", () => {
    expect(
      snapshotContentAsMarkdown(
        JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
        }),
      ),
    ).toBe("Hello");
  });

  it("preserves Markdown unchanged", () => {
    expect(snapshotContentAsMarkdown("## Heading\n\nBody")).toBe("## Heading\n\nBody");
  });
});
