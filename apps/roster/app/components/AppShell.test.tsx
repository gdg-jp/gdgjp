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

  it("uses the event's sheet list as the entry point when no sheet is selected", () => {
    const html = renderShell("/e/evt_1");

    expect(html).toMatch(/<a(?=[^>]*href="\/e\/evt_1")(?=[^>]*aria-current="page")[^>]*>/);
    expect(html).toContain("シフト表一覧");
    expect(html).not.toContain('href="/e/evt_1/design"');
    expect(html).not.toContain('href="/e/evt_1/roster"');
  });

  it("keeps the default sheet's nested link active", () => {
    const html = renderShell("/e/evt_1/s/default:evt_1/design");

    expect(html).toMatch(
      /<a(?=[^>]*href="\/e\/evt_1\/s\/default:evt_1\/design")(?=[^>]*aria-current="page")[^>]*>/,
    );
    expect(html).toContain('href="/e/evt_1/s/default:evt_1/roster"');
    expect(html).toContain('href="/e/evt_1/staff"');
    expect(html).toContain('href="/e/evt_1/share"');
  });

  it("keeps the sheet list available from legacy event-level routes", () => {
    const html = renderShell("/e/evt_1/roster");

    expect(html).toContain('href="/e/evt_1"');
    expect(html).not.toContain('href="/e/evt_1/design"');
  });
});
