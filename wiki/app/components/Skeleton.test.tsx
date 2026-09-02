import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ArticleSkeleton,
  ArticleWithTitleSkeleton,
  CardGridSkeleton,
  MetaBarSkeleton,
  TableSkeleton,
  TocSkeleton,
} from "./Skeleton";

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

  it("CardGridSkeleton and TableSkeleton render correct counts", async () => {
    const gridHtml = await renderToString(<CardGridSkeleton count={3} />);
    expect(gridHtml).toContain("grid gap-3");

    const tableHtml = await renderToString(<TableSkeleton rows={3} cols={2} />);
    expect(tableHtml).toContain("overflow-hidden rounded-lg");
  });
});
