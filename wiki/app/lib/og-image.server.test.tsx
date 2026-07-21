import { describe, expect, it } from "vitest";
import { buildOgImageHtml } from "./og-image.server";

describe("buildOgImageHtml", () => {
  it("renders TipTap page content into the fixed OGP viewport", () => {
    const html = buildOgImageHtml({
      title: "公開ページ",
      content: JSON.stringify({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "概要" }] },
          { type: "paragraph", content: [{ type: "text", text: "本文です。" }] },
        ],
      }),
    });

    expect(html).toContain("width: 1200px; height: 630px");
    expect(html).toContain('<h1 class="page-title">公開ページ</h1>');
    expect(html).toContain("概要");
    expect(html).toContain("本文です。");
  });

  it("escapes user-provided title and legacy plain text", () => {
    const html = buildOgImageHtml({ title: "<script>title</script>", content: "<b>body</b>" });

    expect(html).not.toContain("<script>title</script>");
    expect(html).not.toContain("<b>body</b>");
    expect(html).toContain("&lt;script&gt;title&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;body&lt;/b&gt;");
  });
});
