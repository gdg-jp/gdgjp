import { fileURLToPath } from "node:url";
import type { UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/auth-redirect.server", () => ({
  requireUserWithChapter: vi.fn(),
}));

import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { type TestD1Database, asD1, createTestD1 } from "../../tests/helpers/sqlite-d1";
import { action, loader } from "./e.$id.roster";

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

const OWNER_CHAPTER: UserChapter = { chapterId: 1, chapterSlug: "tokyo", role: "member" };
const OTHER_CHAPTER: UserChapter = { chapterId: 2, chapterSlug: "osaka", role: "member" };

function args(request: Request, db: D1Database) {
  return {
    request,
    params: { id: "evt_1" },
    context: {
      cloudflare: { env: { DB: db } as unknown as Env },
    } as Parameters<typeof loader>[0]["context"],
  };
}

function asOwner() {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: { id: "owner", email: "owner@example.com", name: "Owner", image: null, isAdmin: false },
    chapter: OWNER_CHAPTER,
    chapters: [OWNER_CHAPTER],
  });
}

describe("legacy event roster redirect", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    vi.mocked(requireUserWithChapter).mockReset();
    testDb = createTestD1(MIGRATIONS);
    await testDb
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token,
           created_at, updated_at)
         VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '10:00', 1, 'tok1', 'view1', 'now', 'now')`,
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO roster_sheets
          (id, event_id, name, date, start_time, end_time, seed, sort_order, created_at, updated_at)
         VALUES ('sheet_first', 'evt_1', 'First', '2026-11-07', '09:00', '10:00', 4, -1, 'now', 'now')`,
      )
      .run();
  });

  it("redirects to the first live sheet by stable sheet ordering", async () => {
    asOwner();
    const response = await loader(
      args(new Request("http://localhost/e/evt_1/roster"), asD1(testDb)) as Parameters<
        typeof loader
      >[0],
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/e/evt_1/s/sheet_first/roster");
  });

  it("keeps legacy POST requests read-only and requires chapter authorization", async () => {
    asOwner();
    const post = await action(
      args(
        new Request("http://localhost/e/evt_1/roster", {
          method: "POST",
          body: new FormData(),
        }),
        asD1(testDb),
      ) as Parameters<typeof action>[0],
    );
    expect(post.status).toBe(302);
    expect(post.headers.get("Location")).toBe("/e/evt_1/s/sheet_first/roster");

    vi.mocked(requireUserWithChapter).mockResolvedValue({
      user: { id: "other", email: "other@example.com", name: "Other", image: null, isAdmin: false },
      chapter: OTHER_CHAPTER,
      chapters: [OTHER_CHAPTER],
    });
    await expect(
      loader(
        args(new Request("http://localhost/e/evt_1/roster"), asD1(testDb)) as Parameters<
          typeof loader
        >[0],
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
