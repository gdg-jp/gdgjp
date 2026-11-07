import { beforeEach, describe, expect, it } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";
import { createD1WikiWorkspaceStore } from "./wiki-read-repository";

// Longer than D1's 50-byte LIKE pattern limit once wrapped in %…% (18 characters × 3 bytes).
const LONG_TITLE = "イベント告知対象とコネクション保有者";

let fixture: ReturnType<typeof createSpacesTestDb>;

function insertPage(id: string, title: string, content = "") {
  fixture.sqlite.exec(`
    INSERT INTO pages (id, space_id, title_ja, title_en, slug, content_ja, content_en,
      summary_ja, summary_en, status, visibility, origin, author_id, last_edited_by,
      created_at, updated_at)
    VALUES ('${id}', 'gdg-jp', '${title}', '', '${id}', '${content}', '', '', '',
      'published', 'public', 'human', 'admin', 'admin', 0, 0);
  `);
}

function store() {
  return createD1WikiWorkspaceStore(
    fixture.db as never,
    {
      userId: "alice",
      isAdmin: false,
      chapters: [],
    } as never,
  );
}

beforeEach(() => {
  fixture = createSpacesTestDb();
});

describe("createD1WikiWorkspaceStore search", () => {
  it("finds a page by a title longer than D1's LIKE pattern limit", async () => {
    insertPage("outreach", LONG_TITLE);
    insertPage("other", "別のページ");
    const pages = await store().findPages(LONG_TITLE, { limit: 10, offset: 0 });
    expect(pages.map((p) => p.id)).toEqual(["outreach"]);
  });

  it("matches ASCII case-insensitively, as LIKE did", async () => {
    insertPage("devfest", "DevFest Kansai");
    const pages = await store().findPages("devfest kansai", { limit: 10, offset: 0 });
    expect(pages.map((p) => p.id)).toEqual(["devfest"]);
  });

  it("finds bodies by a long phrase and treats % and _ literally", async () => {
    insertPage("body", "本文", `前文 ${LONG_TITLE} 後文 100%_done`);
    insertPage("decoy", "別", "100xxdone");
    const s = store();
    expect(
      (await s.searchPageBodies(LONG_TITLE, { limit: 10, offset: 0 })).map((p) => p.id),
    ).toEqual(["body"]);
    expect(
      (await s.searchPageBodies("100%_done", { limit: 10, offset: 0 })).map((p) => p.id),
    ).toEqual(["body"]);
  });
});
