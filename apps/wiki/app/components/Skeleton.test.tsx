import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArticleSkeleton, ArticleWithTitleSkeleton, TocSkeleton } from "./Skeleton";

async function renderToString(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const response = new Response(stream);
  return response.text();
}

describe("Skeleton geometry and styling", () => {
  it("TocSkeleton uses md:block to match the 768px desktop sidebar breakpoint", async () => {
    const html = await renderToString(<TocSkeleton />);
    expect(html).toContain("md:block");
    expect(html).not.toContain("lg:block");
  });

  it("ArticleSkeleton does not contain a title placeholder to avoid layout shift when title is already rendered", async () => {
    const html = await renderToString(<ArticleSkeleton />);
    expect(html).not.toContain("h-8");
  });

  it("ArticleWithTitleSkeleton includes title placeholder for preview contexts like HistoryView", async () => {
    const html = await renderToString(<ArticleWithTitleSkeleton />);
    expect(html).toContain("h-8");
  });
});
