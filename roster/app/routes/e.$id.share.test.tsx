import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import SharePage, { loader } from "./e.$id.share";

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

function asChapter(chapter: UserChapter) {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: { id: "user", email: "user@example.com", name: "User", image: null, isAdmin: false },
    chapter,
    chapters: [chapter],
  });
}

function routeArgs(id: string, db: D1Database) {
  const request = new Request(`https://roster.test/e/${id}/share`);
  return {
    request,
    params: { id },
    context: {
      cloudflare: {
        env: { DB: db, APP_URL: "https://roster.test" } as unknown as Env,
      },
    },
    unstable_pattern: "/e/:id/share",
    unstable_url: new URL(request.url),
  };
}

function callLoader(id: string, db: D1Database) {
  return loader(routeArgs(id, db) as unknown as Parameters<typeof loader>[0]);
}

type SharePageProps = Parameters<typeof SharePage>[0];

function renderSharePage(loaderData: Awaited<ReturnType<typeof loader>>) {
  return renderToStaticMarkup(createElement(SharePage, { loaderData } as SharePageProps));
}

async function seedEvent(db: ReturnType<typeof createTestD1>) {
  await db
    .prepare(
      `INSERT INTO events
        (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token,
         created_at, updated_at)
       VALUES ('event', 1, 'DevFest', '2026-11-07', '09:00', '18:00', 42, 'apply', 'view-token',
         'created', 'updated'),
         ('other-event', 2, 'Other event', '2026-11-08', '09:00', '17:00', 7,
         'apply-other', 'other-view-token', 'created', 'updated')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, seed, visibility, sort_order,
         created_at, updated_at, deleted_at)
       VALUES ('sheet-late', 'event', '午後の部', '2026-11-07', '13:00', '18:00', 1,
         'private', 2, 'created', 'updated', NULL),
         ('sheet-first', 'event', '午前の部', '2026-11-07', '09:00', '12:00', 1,
         'published', 1, 'created', 'updated', NULL),
         ('sheet-archived', 'event', 'Archived', '2026-11-07', '12:00', '13:00', 1,
         'published', 0, 'created', 'updated', 'archived')`,
    )
    .run();
}

describe("e.$id.share", () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    db = createTestD1(MIGRATIONS);
    await seedEvent(db);
  });

  it("lists every live sheet in order with sheet URLs and the default legacy URL", async () => {
    asChapter(OWNER);
    const data = await callLoader("event", asD1(db));

    expect(data).toMatchObject({
      event: { id: "event", name: "DevFest", status: "draft" },
      viewUrl: "https://roster.test/r/view-token",
      sheets: [
        {
          id: "default:event",
          name: "本編",
          visibility: "private",
          isDefault: true,
          viewUrl: "https://roster.test/r/view-token/s/default:event",
        },
        {
          id: "sheet-first",
          name: "午前の部",
          visibility: "published",
          isDefault: false,
          viewUrl: "https://roster.test/r/view-token/s/sheet-first",
        },
        {
          id: "sheet-late",
          name: "午後の部",
          visibility: "private",
          isDefault: false,
          viewUrl: "https://roster.test/r/view-token/s/sheet-late",
        },
      ],
    });
    expect(data.sheets.map(({ id }) => id)).not.toContain("sheet-archived");
    expect(JSON.stringify(data)).not.toContain("email");

    const html = renderSharePage(data);
    expect(html).toContain("本編の互換URL");
    expect(html).toContain("シフト表ごとのURL");
    expect(html).toContain('<output class="gdg-sr-only" aria-live="polite">');
    expect(html).toContain("非公開です。公開するまでURLからシフト表の内容は見られません。");
    expect(html).toContain("公開中です。URLを知っている人は誰でも閲覧できます。");
    expect(html).toContain("https://roster.test/r/view-token");
    expect(html).toContain("https://roster.test/r/view-token/s/default:event");
    expect(html).toContain("https://roster.test/r/view-token/s/sheet-first");
    expect(html).toContain("https://roster.test/r/view-token/s/sheet-late");
    expect(html).not.toContain("Archived");
  });

  it("rejects access from another chapter and cross-event requests", async () => {
    asChapter(OTHER);
    await expect(callLoader("event", asD1(db))).rejects.toMatchObject({ status: 403 });

    asChapter(OWNER);
    await expect(callLoader("other-event", asD1(db))).rejects.toMatchObject({ status: 403 });
    await expect(callLoader("missing", asD1(db))).rejects.toMatchObject({ status: 404 });
  });
});
