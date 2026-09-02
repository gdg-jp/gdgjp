import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

async function renderToString(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const response = new Response(stream);
  return response.text();
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("~/hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("~/hooks/useThemeMode", () => ({
  useThemeMode: () => "light",
}));

vi.mock("md-editor-rt", () => ({
  MdPreview: () => <div data-testid="md-preview" />,
}));

vi.mock("~/features/editor/toc", () => ({
  parseMdHeadings: (content: string) =>
    content.includes("## Heading") ? [{ level: 2, text: "Heading", id: "heading" }] : [],
}));

vi.mock("~/features/pages/components/WikiRightSidebar", () => ({
  default: () => <div data-testid="wiki-right-sidebar" />,
}));

vi.mock("./MobileContentsSheet", () => ({
  MobileContentsSheet: () => <div data-testid="mobile-contents-sheet" />,
}));

import { WikiPageBody } from "./WikiPageBody";

describe("WikiPageBody mobile contents button trigger", () => {
  const basePage = {
    id: "p1",
    slug: "test",
    translationStatusJa: "human",
    translationStatusEn: "human",
    updatedAt: new Date(),
  };

  it("renders mobile contents button immediately when headings exist", async () => {
    const html = await renderToString(
      <WikiPageBody
        page={basePage}
        content={{ contentJa: "## Heading", contentEn: "## Heading" }}
        lang="ja"
        isAdmin={false}
        pageMeta={Promise.resolve({
          tags: [],
          author: null,
          editor: null,
          isStarred: false,
          sources: [],
          attachments: [],
        })}
      />,
    );
    expect(html).toContain("wiki.contents");
  });

  it("renders mobile contents button when no headings exist but sources are present", async () => {
    const pageMeta = Promise.resolve({
      tags: [],
      author: null,
      editor: null,
      isStarred: false,
      sources: [{ url: "https://example.com", title: "Source 1" }],
      attachments: [],
    });

    const html = await renderToString(
      <WikiPageBody
        page={basePage}
        content={{ contentJa: "No headings here", contentEn: "No headings here" }}
        lang="ja"
        isAdmin={false}
        pageMeta={pageMeta}
      />,
    );
    expect(html).toContain("wiki.contents");
  });

  it("renders mobile contents button when no headings exist but attachments are present", async () => {
    const pageMeta = Promise.resolve({
      tags: [],
      author: null,
      editor: null,
      isStarred: false,
      sources: [],
      attachments: [{ r2Key: "k1", fileName: "file.pdf", mimeType: "application/pdf" }],
    });

    const html = await renderToString(
      <WikiPageBody
        page={basePage}
        content={{ contentJa: "No headings here", contentEn: "No headings here" }}
        lang="ja"
        isAdmin={false}
        pageMeta={pageMeta}
      />,
    );
    expect(html).toContain("wiki.contents");
  });

  it("does not render mobile contents button when neither headings nor sources/attachments exist", async () => {
    const pageMeta = Promise.resolve({
      tags: [],
      author: null,
      editor: null,
      isStarred: false,
      sources: [],
      attachments: [],
    });

    const html = await renderToString(
      <WikiPageBody
        page={basePage}
        content={{ contentJa: "No headings here", contentEn: "No headings here" }}
        lang="ja"
        isAdmin={false}
        pageMeta={pageMeta}
      />,
    );
    expect(html).not.toContain("wiki.contents");
  });

  it("handles rejected pageMeta gracefully without throwing unhandled rejection", async () => {
    const failingPageMeta = Promise.reject(new Error("D1 connection lost"));
    // Catch rejection to avoid unhandled rejection in node runtime
    failingPageMeta.catch(() => {});

    const html = await renderToString(
      <WikiPageBody
        page={basePage}
        content={{ contentJa: "No headings here", contentEn: "No headings here" }}
        lang="ja"
        isAdmin={false}
        pageMeta={failingPageMeta}
      />,
    );
    // Page body still renders content and doesn't crash
    expect(html).toContain('data-testid="md-preview"');
    expect(html).not.toContain("wiki.contents");
  });
});
