import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { applyAvailabilityBulkChange } from "./ApplyForm";
import type { ApplyFormRosterSheet } from "./ApplyForm";
import { buildAvailabilityState } from "./AvailabilitySheetGrids";
import { ProxyAddDialog } from "./ProxyAddDialog";
import { StaffDrawer, type StaffDrawerDetail } from "./StaffDrawer";

const MAIN: ApplyFormRosterSheet = {
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

const PARTY: ApplyFormRosterSheet = {
  id: "party",
  name: "懇親会",
  date: "2026-11-07",
  startTime: "09:00",
  endTime: "11:00",
  timeSlots: [{ id: "party-0900", start: "09:00", end: "10:00", phaseName: null }],
};

const DETAIL: StaffDrawerDetail = {
  applicationId: "application-1",
  name: "スタッフ",
  withdrawn: false,
  skills: [],
  availability: [{ timeSlotId: "main-0900", value: "d" }],
};

function renderInRouter(element: React.ReactNode) {
  const router = createMemoryRouter(
    [{ path: "/", element: createElement("main", null, element) }],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("staff availability sheets", () => {
  it("renders separately labeled grids while keeping event-level fields singular", () => {
    const html = renderInRouter(
      createElement(ProxyAddDialog, {
        hasParty: true,
        roles: [{ id: "guide", name: "案内" }],
        rosterSheets: [MAIN, PARTY],
        succeeded: undefined,
      }),
    );

    expect(html).toContain("本編 — 2026-11-07 09:00–12:00");
    expect(html).toContain("懇親会 — 2026-11-07 09:00–11:00");
    expect(html).toContain('name="avail_main-0900"');
    expect(html).toContain('name="avail_party-0900"');
    expect(html.match(/担当できる役割/g)).toHaveLength(1);
    expect(html.match(/name="party"/g)).toHaveLength(1);
    expect(html.match(/name="note"/g)).toHaveLength(1);
  });

  it("keeps duplicate local times independent using the unique slot IDs", () => {
    const html = renderInRouter(
      createElement(ProxyAddDialog, {
        hasParty: false,
        roles: [],
        rosterSheets: [MAIN, PARTY],
        succeeded: undefined,
      }),
    );

    expect(html).toContain('name="avail_main-0900"');
    expect(html).toContain('name="avail_party-0900"');
    expect(html.match(/09:00–10:00/g)).toHaveLength(4);
  });

  it("applies a bulk change to only that sheet and preserves values from other sheets", () => {
    const before = { "main-0900": "d", "main-1000": "o", "party-0900": "x" } as const;
    const after = applyAvailabilityBulkChange(before, MAIN.timeSlots, () => "x");

    expect(after).toEqual({ "main-0900": "x", "main-1000": "x", "party-0900": "x" });
    expect(after["party-0900"]).toBe(before["party-0900"]);
  });

  it("shows saved staff answers, defaults missing staff answers to ×, and supports reset defaults", () => {
    const html = renderInRouter(
      createElement(StaffDrawer, {
        detail: DETAIL,
        roles: [],
        rosterSheets: [MAIN, PARTY],
        succeeded: undefined,
        onClose: () => undefined,
      }),
    );

    expect(html).toMatch(
      /<input[^>]*(?=[^>]*name="avail_main-0900")(?=[^>]*value="d")(?=[^>]*checked="")[^>]*>/,
    );
    expect(html).toMatch(
      /<input[^>]*(?=[^>]*name="avail_main-1000")(?=[^>]*value="x")(?=[^>]*checked="")[^>]*>/,
    );
    expect(html).toMatch(
      /<input[^>]*(?=[^>]*name="avail_party-0900")(?=[^>]*value="x")(?=[^>]*checked="")[^>]*>/,
    );
    expect(buildAvailabilityState(MAIN.timeSlots, [], "x")).toEqual({
      "main-0900": "x",
      "main-1000": "x",
    });
  });

  it("defaults proxy answers to ○ and restores those defaults when rebuilt after success", () => {
    const html = renderInRouter(
      createElement(ProxyAddDialog, {
        hasParty: false,
        roles: [],
        rosterSheets: [MAIN, PARTY],
        succeeded: undefined,
      }),
    );

    expect(html).toMatch(
      /<input[^>]*(?=[^>]*name="avail_main-0900")(?=[^>]*value="o")(?=[^>]*checked="")[^>]*>/,
    );
    expect(html).toMatch(
      /<input[^>]*(?=[^>]*name="avail_party-0900")(?=[^>]*value="o")(?=[^>]*checked="")[^>]*>/,
    );
    expect(buildAvailabilityState([PARTY.timeSlots[0]], [], "o")).toEqual({ "party-0900": "o" });
  });

  it("announces an empty grouped list and an empty individual sheet accessibly", () => {
    const emptyList = renderInRouter(
      createElement(ProxyAddDialog, {
        hasParty: false,
        roles: [],
        rosterSheets: [],
        succeeded: undefined,
      }),
    );
    expect(emptyList).toContain("回答できるシフト表がありません。");

    const emptySheet = renderInRouter(
      createElement(StaffDrawer, {
        detail: { ...DETAIL, availability: [] },
        roles: [],
        rosterSheets: [{ ...PARTY, timeSlots: [] }],
        succeeded: undefined,
        onClose: () => undefined,
      }),
    );
    expect(emptySheet).toContain('<legend class="max-w-full px-1 text-sm font-semibold">');
    expect(emptySheet).toContain("このシフト表には選択できる時間枠がありません。");
    expect(emptySheet).not.toContain('type="radio"');
    expect(emptySheet).not.toContain("終日 ○");
  });

  it("keeps legacy flat timeSlots available as one unlabelled group", () => {
    const html = renderInRouter(
      createElement(ProxyAddDialog, {
        hasParty: false,
        roles: [],
        timeSlots: MAIN.timeSlots,
        succeeded: undefined,
      }),
    );

    expect(html).toContain('name="avail_main-0900"');
    expect(html).not.toContain("本編 —");
  });
});
