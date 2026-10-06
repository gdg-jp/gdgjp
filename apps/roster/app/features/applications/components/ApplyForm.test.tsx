import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  ApplyForm,
  type ApplyFormOwn,
  type ApplyFormRosterSheet,
  applyAvailabilityBulkChange,
} from "./ApplyForm";

const MAIN_SHEET: ApplyFormRosterSheet = {
  id: "main",
  name: "本編",
  date: "2026-11-07",
  startTime: "09:00",
  endTime: "12:00",
  timeSlots: [
    { id: "main-0900", start: "09:00", end: "10:00", phaseName: null },
    { id: "main-1000", start: "10:00", end: "11:00", phaseName: null },
  ],
};

const PARTY_SHEET: ApplyFormRosterSheet = {
  id: "party",
  name: "懇親会",
  date: "2026-11-07",
  startTime: "09:00",
  endTime: "11:00",
  timeSlots: [{ id: "party-0900", start: "09:00", end: "10:00", phaseName: null }],
};

function renderForm(
  rosterSheets: readonly ApplyFormRosterSheet[],
  own: ApplyFormOwn | null = null,
  hasParty = true,
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(ApplyForm, {
          hasParty,
          roles: [{ id: "guide", name: "案内" }],
          rosterSheets,
          own,
          defaultName: "テストスタッフ",
        }),
      },
    ],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("ApplyForm grouped availability", () => {
  it("renders one accessibly labeled grid per sheet and keeps event fields singular", () => {
    const html = renderForm([MAIN_SHEET, PARTY_SHEET]);

    expect(html).toContain("本編 — 2026-11-07 09:00–12:00");
    expect(html).toContain("懇親会 — 2026-11-07 09:00–11:00");
    expect(html).toContain('name="avail_main-0900"');
    expect(html).toContain('name="avail_party-0900"');
    expect(html.match(/担当できる役割/g)).toHaveLength(1);
    expect(html.match(/name="party"/g)).toHaveLength(1);
    expect(html.match(/name="note"/g)).toHaveLength(1);
  });

  it("keeps duplicate local times independent through their unique slot IDs", () => {
    const html = renderForm([
      MAIN_SHEET,
      {
        ...PARTY_SHEET,
        timeSlots: [{ id: "party-0900", start: "09:00", end: "10:00", phaseName: null }],
      },
    ]);

    expect(html.match(/09:00–10:00/g)).toHaveLength(4);
    expect(html).toContain('name="avail_main-0900"');
    expect(html).toContain('name="avail_party-0900"');
  });

  it("applies a sheet shortcut only to that sheet and preserves other values", () => {
    const initial = {
      "main-0900": "d",
      "main-1000": "o",
      "party-0900": "x",
    } as const;
    const afterMainShortcut = applyAvailabilityBulkChange(initial, MAIN_SHEET.timeSlots, () => "x");

    expect(afterMainShortcut).toEqual({
      "main-0900": "x",
      "main-1000": "x",
      "party-0900": "x",
    });
    expect(afterMainShortcut["party-0900"]).toBe(initial["party-0900"]);
  });

  it("restores the viewer's saved availability independently for every slot", () => {
    const own: ApplyFormOwn = {
      name: "スタッフ",
      contact: "",
      party: "undecided",
      note: "",
      withdrawn: false,
      skills: [],
      availability: [
        { timeSlotId: "main-0900", value: "d" },
        { timeSlotId: "party-0900", value: "x" },
      ],
    };
    const html = renderForm([MAIN_SHEET, PARTY_SHEET], own);

    expect(html).toContain('<input type="hidden" name="avail_main-0900" value="d"/>');
    expect(html).toContain('<input type="hidden" name="avail_party-0900" value="x"/>');
    expect(html).toContain('<input type="hidden" name="avail_main-1000" value="o"/>');
  });

  it("labels an empty sheet and exposes an accessible empty state without controls", () => {
    const html = renderForm([{ ...PARTY_SHEET, timeSlots: [] }]);

    expect(html).toContain("懇親会 — 2026-11-07 09:00–11:00");
    expect(html).toContain("<output");
    expect(html).toContain("このシフト表には選択できる時間枠がありません。");
    expect(html).not.toContain('name="avail_');
    expect(html).not.toContain("すべて解除");
  });

  it("shows a form-level empty state when no sheet is available", () => {
    const html = renderForm([]);

    expect(html).toContain("回答できるシフト表がありません。");
    expect(html).not.toContain('name="avail_');
  });
});
