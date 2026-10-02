import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRecord } from "~/features/events/events.server";
import type { PublicRosterView } from "~/features/public-roster/types";

vi.mock("~/features/events/events.server", () => ({ getEventByViewToken: vi.fn() }));
vi.mock("~/features/public-roster/public-roster.server", () => ({
  buildPublicRosterData: vi.fn(),
}));

import { getEventByViewToken } from "~/features/events/events.server";
import { buildPublicRosterData } from "~/features/public-roster/public-roster.server";
import { loader as eventLoader } from "./r.$token";
import { loader as sheetLoader, meta as sheetMeta } from "./r.$token.s.$sheetId";

const EVENT: EventRecord = {
  id: "evt_1",
  chapterId: 1,
  name: "DevFest",
  date: "2026-11-07",
  startTime: "09:00",
  endTime: "19:00",
  stepMin: 60,
  tz: "Asia/Tokyo",
  status: "published",
  hasParty: false,
  noSoloNewcomer: false,
  maxConsecutive: 4,
  seed: 1,
  applyToken: "apply-token",
  viewToken: "view-token",
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const PRIVATE_VIEW: PublicRosterView = {
  published: false,
  event: {
    id: "evt_1",
    name: "DevFest",
    date: "2026-11-07",
    startTime: "09:00",
    endTime: "19:00",
    hasParty: false,
    sheet: { name: "Private sheet", date: "2026-12-01", startTime: "12:00", endTime: "14:00" },
  },
};

const PUBLISHED_VIEW: PublicRosterView = {
  published: true,
  data: {
    event: {
      id: "evt_1",
      name: "DevFest",
      date: "2026-11-07",
      startTime: "09:00",
      endTime: "19:00",
      hasParty: false,
      sheet: { name: "午前の部", date: "2026-11-07", startTime: "09:00", endTime: "12:00" },
    },
    slots: [],
    tracks: [],
    roles: [],
    staff: [],
    assignments: [],
  },
};

function routeArgs(params: { token?: string; sheetId?: string }) {
  const request = new Request("https://roster.test/r/view-token/s/sheet_1");
  return {
    request,
    params,
    context: { cloudflare: { env: { DB: {} } } },
    unstable_pattern: "/r/:token/s/:sheetId",
    unstable_url: new URL(request.url),
  };
}

describe("r.$token.s.$sheetId loader", () => {
  beforeEach(() => {
    vi.mocked(getEventByViewToken).mockReset();
    vi.mocked(buildPublicRosterData).mockReset();
  });

  it("uses the selected event and sheet names in public and private page metadata", () => {
    expect(sheetMeta({ data: PRIVATE_VIEW } as Parameters<typeof sheetMeta>[0])).toEqual([
      { title: "DevFest — Private sheet — シフト表 — roster" },
    ]);
    expect(sheetMeta({ data: PUBLISHED_VIEW } as Parameters<typeof sheetMeta>[0])).toEqual([
      { title: "DevFest — 午前の部 — シフト表 — roster" },
    ]);
  });

  it("uses the generic metadata fallback when route data is unavailable", () => {
    expect(sheetMeta({ data: undefined } as Parameters<typeof sheetMeta>[0])).toEqual([
      { title: "roster" },
    ]);
  });

  it("resolves the event by view token and asks the public builder for only the selected sheet", async () => {
    const db = {} as D1Database;
    const context = { cloudflare: { env: { DB: db } } };
    vi.mocked(getEventByViewToken).mockResolvedValue(EVENT);
    vi.mocked(buildPublicRosterData).mockResolvedValue(PRIVATE_VIEW);

    const args = routeArgs({ token: "view-token", sheetId: "sheet_1" });
    args.context = context;
    const result = await sheetLoader(args as unknown as Parameters<typeof sheetLoader>[0]);

    expect(getEventByViewToken).toHaveBeenCalledWith(db, "view-token");
    expect(buildPublicRosterData).toHaveBeenCalledWith(db, EVENT, "sheet_1");
    expect(result).toEqual(PRIVATE_VIEW);
    expect("data" in result).toBe(false);
  });

  it("404s when either token or sheet ID is missing, before querying the event", async () => {
    await expect(
      sheetLoader(
        routeArgs({ token: "view-token" }) as unknown as Parameters<typeof sheetLoader>[0],
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      sheetLoader(
        routeArgs({ sheetId: "sheet_1" }) as unknown as Parameters<typeof sheetLoader>[0],
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(getEventByViewToken).not.toHaveBeenCalled();
    expect(buildPublicRosterData).not.toHaveBeenCalled();
  });

  it("404s an unknown view token without asking the builder for data", async () => {
    vi.mocked(getEventByViewToken).mockResolvedValue(null);
    await expect(
      sheetLoader(
        routeArgs({ token: "unknown", sheetId: "sheet_1" }) as unknown as Parameters<
          typeof sheetLoader
        >[0],
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(buildPublicRosterData).not.toHaveBeenCalled();
  });

  it("preserves the event route's default-sheet builder call", async () => {
    const db = {} as D1Database;
    const request = new Request("https://roster.test/r/view-token");
    vi.mocked(getEventByViewToken).mockResolvedValue(EVENT);
    vi.mocked(buildPublicRosterData).mockResolvedValue(PRIVATE_VIEW);

    await eventLoader({
      ...routeArgs({ token: "view-token" }),
      request,
      context: { cloudflare: { env: { DB: db } } },
      unstable_pattern: "/r/:token",
      unstable_url: new URL(request.url),
    } as unknown as Parameters<typeof eventLoader>[0]);

    expect(buildPublicRosterData).toHaveBeenCalledWith(db, EVENT);
  });
});
