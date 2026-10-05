import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseNavigation = vi.hoisted(() => vi.fn());
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigation: () => mockUseNavigation(),
}));

import { CellDrawer } from "./CellDrawer";

function renderDrawer() {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(CellDrawer, {
          selection: {
            applicationId: "app_1",
            applicationName: "スタッフ",
            slotId: "slot_1",
            slotLabel: "09:00–10:00",
          },
          current: null,
          candidates: [],
          trackNameById: new Map(),
          roleNameById: new Map(),
          succeeded: undefined,
          onClose: () => {},
          crossSheetWarning: {
            conflicts: [
              {
                sheetId: "sheet_after",
                sheetName: "懇親会",
                date: "2026-11-07",
                siblingSlotId: "slot_after",
                startTime: "09:30",
                endTime: "10:30",
                targetSlotId: "slot_1",
                targetStartTime: "09:00",
                targetEndTime: "10:00",
              },
            ],
            assignment: {
              applicationId: "app_1",
              trackId: "track_1",
              roleId: "guide",
              slotIds: ["slot_1"],
            },
            confirmation: "signed-confirmation",
          },
        }),
      },
    ],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("CellDrawer cross-sheet warning", () => {
  beforeEach(() => {
    mockUseNavigation.mockReturnValue({ state: "idle", formData: null });
  });

  it("announces the sibling sheet and resubmits a separate exact confirmation form", () => {
    const html = renderDrawer();
    const warning = html.match(/<section[^>]*role="alert"[^>]*>[\s\S]*?<\/section>/)?.[0];

    expect(warning).toContain("別のシフト表の割当と時間が重複しています");
    expect(warning).toContain("懇親会（2026-11-07）09:30–10:30");
    expect(warning).toContain("重複を承知で割り当てる");
    expect(warning).toContain('name="applicationId" value="app_1"');
    expect(warning).toContain('name="slotId" value="slot_1"');
    expect(warning).toContain('name="conflictConfirmation" value="signed-confirmation"');
    expect(warning).toContain("対象 09:00–10:00 と重複");
  });

  it("disables the confirmation button while its request is submitting", () => {
    const formData = new FormData();
    formData.set("conflictConfirmation", "signed-confirmation");
    mockUseNavigation.mockReturnValue({ state: "submitting", formData });

    const html = renderDrawer();
    const button = html.match(/<button(?=[^>]*disabled)[^>]*>[\s\S]*?<\/button>/)?.[0];

    expect(button).toContain("disabled");
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain("割り当て中…");
  });
});
