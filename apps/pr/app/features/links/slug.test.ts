import { describe, expect, it } from "vitest";
import { shortlinkSlug, withShortlink } from "./slug";

describe("shortlinkSlug", () => {
  it("joins campaign, kind and item", () => {
    expect(shortlinkSlug("devfest-kansai-2026", "x_post", 42)).toBe("devfest-kansai-2026-x-42");
  });
  it("keeps 40 characters by cutting the campaign part, never leaving a trailing hyphen", () => {
    const slug = shortlinkSlug(
      "a-very-long-campaign-slug-for-an-event-2026",
      "connpass_mail",
      1234,
    );
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-mail-1234")).toBe(true);
    expect(slug).not.toContain("--");
  });
});

describe("withShortlink", () => {
  it("replaces every placeholder and leaves text without a link alone", () => {
    expect(withShortlink("a {{shortlink}} b {{shortlink}}", "https://gdgs.jp/x")).toBe(
      "a https://gdgs.jp/x b https://gdgs.jp/x",
    );
    expect(withShortlink("a {{shortlink}}", null)).toBe("a {{shortlink}}");
  });
});
