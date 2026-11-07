import { describe, expect, it } from "vitest";
import { matchSnippet } from "./keyword-snippet";

describe("matchSnippet", () => {
  it("windows the first field that contains the first term, Markdown stripped", () => {
    expect(matchSnippet(["", "## 予算\n\n会場費は **20万円**。"], ["会場費"])).toBe(
      "予算 会場費は 20万円。",
    );
    expect(
      matchSnippet(
        ["- Wi-Fi は RJ-45 で（source: ih4Sh7MfqJi20Gs1i61v）確認 (sourceId: abc)"],
        ["Wi-Fi"],
      ),
    ).toBe("Wi-Fi は RJ-45 で確認");
    expect(matchSnippet(["題名だけ"], ["会場費"])).toBe("");
    const long = `${"a".repeat(100)} 会場費 ${"b".repeat(200)}`;
    const out = matchSnippet([long], ["会場費"]);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("会場費");
  });
});
