import { describe, expect, it } from "vitest";
import { buildPageMeta } from "./page-meta";

const baseInput = {
  title: "テストページ",
  description: "ページの概要です。",
  origin: "https://wiki.gdgjp.dev",
  pathname: "/wiki/test-page",
};

describe("buildPageMeta", () => {
  it.each(["public", "unlisted"])("adds OGP for %s pages", (visibility) => {
    const meta = buildPageMeta({ ...baseInput, visibility });

    expect(meta).toContainEqual({ property: "og:title", content: "テストページ" });
    expect(meta).toContainEqual({ property: "og:site_name", content: "GDG Japan Wiki" });
    expect(meta).toContainEqual({ property: "og:description", content: "ページの概要です。" });
    expect(meta).toContainEqual({
      property: "og:url",
      content: "https://wiki.gdgjp.dev/wiki/test-page",
    });
    expect(meta).toContainEqual({
      property: "og:image",
      content: "https://wiki.gdgjp.dev/og-image.png",
    });
    expect(meta).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
  });

  it("keeps unlisted pages out of search engines", () => {
    const meta = buildPageMeta({ ...baseInput, visibility: "unlisted" });

    expect(meta).toContainEqual({ name: "robots", content: "noindex,nofollow" });
  });

  it("does not expose page details through OGP for restricted pages", () => {
    const meta = buildPageMeta({ ...baseInput, visibility: "restricted" });

    expect(meta).toEqual([
      { title: "テストページ — GDG Japan Wiki" },
      { name: "robots", content: "noindex,nofollow" },
    ]);
  });

  it("normalizes descriptions and supplies a fallback", () => {
    expect(
      buildPageMeta({ ...baseInput, visibility: "public", description: "  one\n  two  " }),
    ).toContainEqual({ name: "description", content: "one two" });
    expect(buildPageMeta({ ...baseInput, visibility: "public", description: "" })).toContainEqual({
      name: "description",
      content: "「テストページ」— GDG Japan Wiki",
    });
  });

  it("uses a versioned page-specific OGP image URL", () => {
    const meta = buildPageMeta({
      ...baseInput,
      visibility: "public",
      imagePath: "/og/wiki/test-page?lang=ja&v=123",
    });

    expect(meta).toContainEqual({
      property: "og:image",
      content: "https://wiki.gdgjp.dev/og/wiki/test-page?lang=ja&v=123",
    });
  });
});
