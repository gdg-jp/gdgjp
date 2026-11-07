import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";

const state = vi.hoisted(() => ({
  db: null as unknown,
  hideAgentPages: false,
}));

vi.mock("~/lib/db.server", () => ({ getDb: () => state.db }));
vi.mock("~/features/auth/utils.server", () => ({
  getAccessIdentity: async () => ({ user: { id: "alice", isAdmin: false }, chapters: [] }),
}));
vi.mock("~/features/spaces/viewer.server", () => ({
  loadViewerContext: async () => ({
    visibleSpaceIds: ["gdg-jp"],
    access: new Map([["gdg-jp", "viewer"]]),
    hideAgentPages: state.hideAgentPages,
  }),
}));
vi.mock("~/features/pages/wiki-page-path.server", () => ({
  getWikiPageUrls: async (_env: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, `/s/gdg-jp/wiki/${id}`])),
  getWikiAncestry: async (_env: unknown, ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        [
          { id: "root", slug: "root", titleJa: "親", titleEn: "Parent" },
          { id, slug: id, titleJa: id, titleEn: "" },
        ],
      ]),
    ),
}));

const { loadWikiSearch } = await import("./wiki-search.server");

type Fixture = {
  db: ReturnType<typeof createSpacesTestDb>["db"];
  sqlite: { exec(s: string): void };
};
let fixture: Fixture;

function insertPage(id: string, title: string, opts: { space?: string; origin?: string } = {}) {
  fixture.sqlite.exec(`
    INSERT INTO pages (id, space_id, title_ja, title_en, slug, content_ja, content_en,
      summary_ja, summary_en, status, visibility, origin, author_id, last_edited_by,
      created_at, updated_at)
    VALUES ('${id}', '${opts.space ?? "gdg-jp"}', '${title}', '', '${id}', '', '', '', '',
      'published', 'public', '${opts.origin ?? "human"}', 'admin', 'admin', 0, 0);
  `);
}

async function search(q: string) {
  const url = `https://wiki.example/search?q=${encodeURIComponent(q)}`;
  const data = await loadWikiSearch(new Request(url), {} as Env);
  return { ...data, titles: data.results.map((r) => r.titleJa) };
}

beforeEach(() => {
  fixture = createSpacesTestDb() as unknown as Fixture;
  state.db = fixture.db;
  state.hideAgentPages = false;
  fixture.sqlite.exec(
    "INSERT INTO spaces (id, slug, name, kind) VALUES ('other', 'other', 'Other', 'shared');",
  );
});

describe("loadWikiSearch keyword mode", () => {
  it("finds two-character Japanese terms, which the trigram index cannot match", async () => {
    insertPage("p1", "DevFest 関西 会場");
    insertPage("p2", "東京の会場");
    insertPage("p3", "スポンサー募集");

    expect((await search("会場")).titles.sort()).toEqual(["DevFest 関西 会場", "東京の会場"]);
    expect((await search("関西")).titles).toEqual(["DevFest 関西 会場"]);
  });

  it("treats LIKE wildcards in short queries as literals", async () => {
    insertPage("p1", "100% 参加");
    insertPage("p2", "参加者");

    expect((await search("%")).titles).toEqual(["100% 参加"]);
  });

  it("filters before the 50-result cut so other spaces cannot crowd out the reader's pages", async () => {
    for (let i = 0; i < 60; i++)
      insertPage(`o${i}`, `DevFest DevFest DevFest ${i}`, { space: "other" });
    insertPage("mine", "DevFest のふりかえり");

    expect((await search("DevFest")).titles).toEqual(["DevFest のふりかえり"]);
  });

  it("hides agent pages when the reader asked to, and says so", async () => {
    insertPage("h", "DevFest 手順");
    insertPage("a", "DevFest まとめ", { origin: "agent" });

    expect((await search("DevFest")).titles.sort()).toEqual(["DevFest まとめ", "DevFest 手順"]);

    state.hideAgentPages = true;
    const hidden = await search("DevFest");
    expect(hidden.titles).toEqual(["DevFest 手順"]);
    expect(hidden.hideAgentPages).toBe(true);
  });

  it("names each result's parents and, outside a space, its space", async () => {
    insertPage("p1", "DevFest 関西 会場");
    const unscoped = await search("会場");
    expect(unscoped.scoped).toBe(false);
    expect(unscoped.results[0]?.ancestors).toEqual([{ titleJa: "親", titleEn: "Parent" }]);
    expect(unscoped.results[0]?.spaceName).toBe("GDG Japan");

    const url = "https://wiki.example/s/gdg-jp/search?q=%E4%BC%9A%E5%A0%B4";
    const scoped = await loadWikiSearch(new Request(url), {} as Env, "gdg-jp");
    expect(scoped.scoped).toBe(true);
    expect(scoped.results[0]?.spaceName).toBe("");
  });
});
