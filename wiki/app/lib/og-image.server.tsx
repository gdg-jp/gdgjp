import { Marked, Renderer } from "marked";
import { renderToStaticMarkup } from "react-dom/server";
import { TipTapRenderer } from "~/components/TipTapRenderer";
import type { TipTapDoc } from "~/lib/tiptap-convert";

type OgImageHtmlInput = {
  content: string;
  title: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const markdownRenderer = new Renderer();
markdownRenderer.html = ({ text }) => escapeHtml(text);
markdownRenderer.link = function renderLink({ tokens }) {
  return `<span class="link">${this.parser.parseInline(tokens)}</span>`;
};
markdownRenderer.image = ({ text }) => (text ? `<span>${escapeHtml(text)}</span>` : "");

const markdownParser = new Marked({
  async: false,
  gfm: true,
  renderer: markdownRenderer,
});

function parseTipTapContent(content: string): TipTapDoc | null {
  try {
    const parsed = JSON.parse(content) as Partial<TipTapDoc>;
    if (parsed.type === "doc" && Array.isArray(parsed.content)) {
      return parsed as TipTapDoc;
    }
  } catch {
    // Markdown content is rendered by Marked below.
  }

  return null;
}

function renderContent(content: string) {
  const tipTapDoc = parseTipTapContent(content);
  if (tipTapDoc) return renderToStaticMarkup(<TipTapRenderer doc={tipTapDoc} />);
  return markdownParser.parse(content) as string;
}

export function buildOgImageHtml({ content, title }: OgImageHtmlInput) {
  const renderedContent = renderContent(content);
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
        background: #ffffff;
        color: #1f2937;
        font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif;
      }
      main {
        position: relative;
        width: 1200px;
        min-height: 630px;
        padding: 54px 68px 64px;
        background: #ffffff;
      }
      h1.page-title {
        max-width: 1030px;
        margin: 0 0 32px;
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
      .content .link { color: #2563eb; text-decoration: underline; }
      .content table { width: 100%; border-collapse: collapse; font-size: 18px; }
      .content th, .content td { padding: 8px 12px; border: 1px solid #d1d5db; }
      .content img { display: none; }
    </style>
  </head>
  <body>
    <main>
      <h1 class="page-title">${renderedTitle}</h1>
      <article class="content">${renderedContent}</article>
    </main>
  </body>
</html>`;
}
