import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { RosterSheetCard } from "./RosterSheetCard";

function renderCard(archivePending: boolean) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(RosterSheetCard, {
          sheet: {
            id: "sheet-1",
            name: "午前のシフト",
            date: "2026-11-07",
            startTime: "09:00",
            endTime: "12:00",
          },
          visibility: "private",
          isDefault: false,
          visibilityPending: false,
          archivePending,
        }),
      },
    ],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("RosterSheetCard", () => {
  it("disables and announces the archive trigger while submission is pending", () => {
    const html = renderCard(true);
    const trigger = html.match(
      /<button(?=[^>]*aria-label="アーカイブ中")[^>]*>[\s\S]*?<\/button>/,
    )?.[0];

    expect(trigger).toBeDefined();
    expect(trigger).toContain('aria-busy="true"');
    expect(trigger).toContain("disabled");
    expect(trigger).toContain("アーカイブ中…");
  });
});
