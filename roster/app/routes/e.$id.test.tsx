import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import EventOverview, { loader } from "./e.$id";

const MIGRATIONS = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
  "0010_revisions_sheet_sequence.sql",
].map((name) => fileURLToPath(new URL(`../../migrations/${name}`, import.meta.url)));

const OWNER: UserChapter = { chapterId: 1, chapterSlug: "tokyo", role: "member" };
const OTHER: UserChapter = { chapterId: 99, chapterSlug: "osaka", role: "member" };

function mockContext(db: D1Database) {
  return {
    cloudflare: { env: { DB: db } as unknown as Env },
  } as Parameters<typeof loader>[0]["context"];
}

function callLoader(id: string, db: D1Database) {
  const request = new Request(`http://localhost/e/${id}`);
  return loader({
    request,
    params: { id },
    context: mockContext(db),
    unstable_pattern: "/e/:id",
    unstable_url: new URL(request.url),
  } as Parameters<typeof loader>[0]);
}

function asChapter(chapter: UserChapter) {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: { id: "user", email: "user@example.com", name: "User", image: null, isAdmin: false },
    chapter,
    chapters: [chapter],
  });
}

async function seedEvent(db: ReturnType<typeof createTestD1>) {
  await db
    .prepare(
      `INSERT INTO events
        (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token,
         created_at, updated_at)
       VALUES ('event', 1, 'DevFest', '2026-11-07', '09:00', '18:00', 42, 'apply', 'view',
         'created', 'updated')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, seed, visibility, sort_order,
         created_at, updated_at)
       VALUES ('sheet-late', 'event', '午後の部', '2026-11-07', '13:00', '18:00', 1,
         'private', 2, 'created', 'updated'),
         ('sheet-first', 'event', '午前の部', '2026-11-07', '09:00', '12:00', 1,
         'published', 1, 'created', 'updated'),
         ('sheet-archived', 'event', 'Archived', '2026-11-07', '12:00', '13:00', 1,
         'published', 0, 'created', 'updated')`,
    )
    .run();
  await db
    .prepare("UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'sheet-archived'")
    .run();
}

describe("e.$id overview", () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    db = createTestD1(MIGRATIONS);
    await seedEvent(db);
  });

  it("requires chapter ownership and returns live sheets in sort order", async () => {
    asChapter(OWNER);
    const data = await callLoader("event", asD1(db));
    expect(data.event).toEqual({ id: "event", name: "DevFest" });
    expect(data.sheets.map((sheet) => [sheet.id, sheet.visibility])).toEqual([
      ["default:event", "private"],
      ["sheet-first", "published"],
      ["sheet-late", "private"],
    ]);
  });

  it("rejects unknown events and events from another chapter", async () => {
    asChapter(OWNER);
    await expect(callLoader("missing", asD1(db))).rejects.toMatchObject({ status: 404 });
    asChapter(OTHER);
    await expect(callLoader("event", asD1(db))).rejects.toMatchObject({ status: 403 });
  });

  it("renders sheet details and event-level navigation without unfinished sheet links", async () => {
    asChapter(OWNER);
    const data = await callLoader("event", asD1(db));
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(EventOverview, { loaderData: data })),
    );

    expect(html).toContain("本編");
    expect(html).toContain("午前の部");
    expect(html).toContain("2026-11-07");
    expect(html).toContain("09:00");
    expect(html).toContain("公開");
    expect(html).toContain("非公開");
    expect(html).toContain('href="/e/event/staff"');
    expect(html).toContain('href="/e/event/share"');
    expect(html).not.toContain("/s/");
    expect(html).toContain("シフト表ごとの設計・管理画面は準備中です。");
    expect(html).not.toContain("sheet-archived");
  });

  it("renders a useful empty state when no live sheets remain", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(EventOverview, {
          loaderData: { event: { id: "event", name: "DevFest" }, sheets: [] },
        }),
      ),
    );
    expect(html).toContain("シフト表はまだありません。");
    expect(html).toContain("<output");
  });
});
