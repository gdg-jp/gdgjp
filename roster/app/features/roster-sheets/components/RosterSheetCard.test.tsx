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
          eventId: "event-1",
          visibility: "private",
          isDefault: false,
          visibilityPending: false,
          archivePending,
          reorderSheetIds: ["default:event-1", "sheet-1", "sheet-2"],
          reorderPending: false,
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

  it("submits the complete resulting order with accessible move controls", () => {
    const html = renderCard(false);

    expect(html).toContain('aria-label="「午前のシフト」を上へ移動"');
    expect(html).toContain('aria-label="「午前のシフト」を下へ移動"');
    expect(html).toMatch(
      /name="sheetIds" value="default:event-1"[\s\S]*?name="sheetIds" value="sheet-2"[\s\S]*?name="sheetIds" value="sheet-1"[\s\S]*?aria-label="「午前のシフト」を下へ移動"/,
    );
  });
});
