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

  it("renders Markdown structure instead of showing Markdown syntax", () => {
    const html = buildOgImageHtml({
      title: "Markdown page",
      content: [
        "# 用語",
        "",
        "- Codelab",
        "- [Agent Skills](https://example.com)",
        "",
        "`claude` コマンドを使います。",
      ].join("\n"),
    });

    expect(html).toContain("<h1>用語</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Codelab</li>");
    expect(html).toContain('<span class="link">Agent Skills</span>');
    expect(html).toContain("<code>claude</code>");
    expect(html).not.toContain("# 用語");
    expect(html).not.toContain("https://example.com");
  });

  it("uses a completely white background without branding", () => {
    const html = buildOgImageHtml({ title: "Page", content: "Body" });

    expect(html).toContain("background: #ffffff;");
    expect(html).not.toContain("radial-gradient");
    expect(html).not.toContain("GDG Japan Wiki");
    expect(html).not.toContain('class="brand"');
  });
});
