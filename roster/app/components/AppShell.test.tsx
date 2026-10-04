import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

const shell = (
  <AppShell
    user={{ name: "Owner", email: "owner@example.com", image: null }}
    chapters={[{ id: 1, slug: "chapter" }]}
    events={[
      { id: "evt_1", chapterId: 1, name: "Event One", date: "2026-11-07", status: "open" },
      { id: "evt_2", chapterId: 1, name: "Event Two", date: "2026-12-01", status: "draft" },
    ]}
    accountsUrl="https://accounts.example.com"
  >
    <main>Content</main>
  </AppShell>
);

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/e/:id", element: shell },
      { path: "/e/:id/:section", element: shell },
      { path: "/e/:id/s/:sheetId/:section", element: shell },
    ],
    { initialEntries: [path] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("AppShell sheet context", () => {
  it("keeps design and roster links within the active sheet route", () => {
    const html = renderShell("/e/evt_1/s/sheet_party/roster");

    expect(html).toContain('href="/e/evt_1/s/sheet_party/design"');
    expect(html).toMatch(
      /<a(?=[^>]*href="\/e\/evt_1\/s\/sheet_party\/roster")(?=[^>]*aria-current="page")[^>]*>/,
    );
    expect(html).toContain('href="/e/evt_1/staff"');
    expect(html).toContain('href="/e/evt_1/share"');
    expect(html).toContain('href="/e/evt_1"');
  });

  it("keeps legacy event-level navigation active when no sheet param is present", () => {
    const html = renderShell("/e/evt_1/design");

    expect(html).toMatch(/<a(?=[^>]*href="\/e\/evt_1\/design")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).toContain('href="/e/evt_1/roster"');
    expect(html).not.toContain("/s/");
  });

  it("encodes sheet IDs as one path segment and keeps the nested link active", () => {
    const html = renderShell("/e/evt_1/s/default%3Aevt_1/design");

    expect(html).toMatch(
      /<a(?=[^>]*href="\/e\/evt_1\/s\/default%3Aevt_1\/design")(?=[^>]*aria-current="page")[^>]*>/,
    );
    expect(html).toContain('href="/e/evt_1/s/default%3Aevt_1/roster"');
    expect(html).toContain('href="/e/evt_1/staff"');
    expect(html).toContain('href="/e/evt_1/share"');
  });

  it("keeps a legacy roster route at the event level for the default sheet", () => {
    const html = renderShell("/e/evt_1/roster");

    expect(html).toMatch(/<a(?=[^>]*href="\/e\/evt_1\/roster")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).toContain('href="/e/evt_1/design"');
  });
});
