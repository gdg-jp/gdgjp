import { describe, expect, it } from "vitest";
import {
  displayedMarkdown,
  linkInlineSourceRefs,
  rewriteCopiedLinks,
  stripLeadingTitleHeading,
} from "./page-menu-content";

describe("page menu content", () => {
  it("preserves invalid URLs and remaps URL-encoded attachment names", () => {
    expect(
      rewriteCopiedLinks(
        "https://% ![x](/api/images/wiki/old/a%20b.png)",
        new Map([["/api/images/wiki/old/a b.png", "/api/images/wiki/new/file.png"]]),
        "https://wiki.test",
      ),
    ).toBe("https://% ![x](/api/images/wiki/new/file.png)");
  });
  it("selects exactly the displayed language, including whitespace-only fallbacks", () => {
    expect(displayedMarkdown({ contentJa: "日本語", contentEn: " \n" }, "en")).toBe("日本語");
    expect(displayedMarkdown({ contentJa: "日本語", contentEn: "English" }, "en")).toBe("English");
    expect(displayedMarkdown({ contentJa: "", contentEn: "English" }, "ja")).toBe("English");
  });
  it("remaps same-origin page/image links and retains query strings, anchors, external links and code", () => {
    const input =
      "[child](/wiki/child?lang=en#heading)\n![image](https://wiki.test/api/images/wiki/old/a.png)\n[external](https://other.test/wiki/child)\n`/wiki/child`\n\n```md\n/wiki/child\n```\n";
    const actual = rewriteCopiedLinks(
      input,
      new Map([
        ["/wiki/child", "/wiki/copy/child-copy"],
        ["/api/images/wiki/old/a.png", "/api/images/wiki/new/b.png"],
      ]),
      "https://wiki.test",
    );
    expect(actual).toBe(
      input
        .replace("(/wiki/child?", "(/wiki/copy/child-copy?")
        .replace("https://wiki.test/api/images/wiki/old/a.png", "/api/images/wiki/new/b.png"),
    );
  });
  it("drops a leading heading only when it repeats the page title", () => {
    expect(stripLeadingTitleHeading("# 会場・当日運営\n\n本文", "会場・当日運営")).toBe("本文");
    expect(stripLeadingTitleHeading("# Venue  ops #\n本文", "venue ops")).toBe("本文");
    expect(stripLeadingTitleHeading("# 別の見出し\n本文", "会場")).toBe("# 別の見出し\n本文");
    expect(stripLeadingTitleHeading("本文\n# 会場", "会場")).toBe("本文\n# 会場");
  });
  it("turns inline (source: id) citations into links", () => {
    const refs = [
      { sourceId: "FNFVEcXXHArML5Yru8ts6", url: "https://docs.example/a", title: 'Minutes "FY26"' },
    ];
    expect(linkInlineSourceRefs("決定。（source: FNFVEcXXHArML5Yru8ts6）", refs, "出典")).toBe(
      '決定。[出典](https://docs.example/a "Minutes FY26")',
    );
    expect(linkInlineSourceRefs("x (source: unknown123)", refs, "出典")).toBe(
      "x [出典](#page-sources)",
    );
    expect(linkInlineSourceRefs("(source: a)", refs, "出典")).toBe("(source: a)");
  });
});
