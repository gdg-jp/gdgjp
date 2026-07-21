import { renderToStaticMarkup } from "react-dom/server";
import { TipTapRenderer } from "~/components/TipTapRenderer";
import type { TipTapDoc } from "~/lib/tiptap-convert";

type OgImageHtmlInput = {
  content: string;
  title: string;
};

function parseContent(content: string): TipTapDoc {
  try {
    const parsed = JSON.parse(content) as Partial<TipTapDoc>;
    if (parsed.type === "doc" && Array.isArray(parsed.content)) {
      return parsed as TipTapDoc;
    }
  } catch {
    // Legacy pages can contain plain text instead of TipTap JSON.
  }

  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: content }] }],
  };
}

export function buildOgImageHtml({ content, title }: OgImageHtmlInput) {
  const renderedContent = renderToStaticMarkup(<TipTapRenderer doc={parseContent(content)} />);
  const renderedTitle = renderToStaticMarkup(title);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
      body {
        background: #f8fafc;
        color: #1f2937;
        font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif;
      }
      main {
        position: relative;
        width: 1200px;
        min-height: 630px;
        padding: 48px 68px 64px;
        background:
          radial-gradient(circle at 100% 0%, rgba(59, 130, 246, 0.14), transparent 34%),
          #ffffff;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 24px;
        color: #2563eb;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }
      .brand-mark {
        width: 18px;
        height: 18px;
        border-radius: 5px;
        background: #3b82f6;
        box-shadow: 7px 7px 0 #facc15;
      }
      h1.page-title {
        max-width: 1030px;
        margin: 0 0 28px;
        color: #111827;
        font-size: 48px;
        font-weight: 750;
        line-height: 1.24;
        letter-spacing: -0.025em;
      }
      .content {
        max-width: 1010px;
        font-size: 22px;
        line-height: 1.7;
      }
      .content p { margin: 0 0 18px; }
      .content h1, .content h2, .content h3,
      .content h4, .content h5, .content h6 {
        margin: 24px 0 12px;
        color: #111827;
        font-weight: 700;
        line-height: 1.35;
      }
      .content h1 { font-size: 34px; }
      .content h2 { font-size: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
      .content h3 { font-size: 26px; }
      .content ul, .content ol { margin: 0 0 18px; padding-left: 34px; }
      .content li { margin: 4px 0; }
      .content blockquote {
        margin: 18px 0;
        padding-left: 20px;
        border-left: 5px solid #93c5fd;
        color: #4b5563;
      }
      .content pre {
        margin: 18px 0;
        padding: 18px 22px;
        overflow: hidden;
        border-radius: 12px;
        background: #f1f5f9;
        font-size: 18px;
        line-height: 1.5;
      }
      .content code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .content table { width: 100%; border-collapse: collapse; font-size: 18px; }
      .content th, .content td { padding: 8px 12px; border: 1px solid #d1d5db; }
      .content img { display: none; }
      .fade {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        height: 54px;
        background: linear-gradient(transparent, #ffffff 80%);
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="brand-mark"></span>GDG Japan Wiki</div>
      <h1 class="page-title">${renderedTitle}</h1>
      <article class="content">${renderedContent}</article>
      <div class="fade"></div>
    </main>
  </body>
</html>`;
}
