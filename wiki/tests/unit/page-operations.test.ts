import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "~/features/auth/utils.server";
import { requireUser } from "~/features/auth/utils.server";
import { duplicatePage } from "~/features/pages/duplicate.server";
import { movePage } from "~/features/pages/move.server";
import { loader as loadMoveTargets } from "~/routes/api/pages/move-targets";

vi.mock("~/features/auth/utils.server", () => ({ requireUser: vi.fn() }));

class Statement {
  private values: unknown[] = [];
  constructor(
    private db: Database.Database,
    private sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.values) };
  }
  async raw() {
    return this.db
      .prepare(this.sql)
      .raw()
      .all(...this.values);
  }
  runSync() {
    return this.db.prepare(this.sql).run(...this.values);
  }
}

describe("page tree operations", () => {
  let sqlite: Database.Database;
  let env: Env;
  const user = { id: "author", isAdmin: false, email: "author@example.com" } as AuthUser;
  const bucketGet = vi.fn();
  const bucketPut = vi.fn();
  const bucketDelete = vi.fn();
  const batch = vi.fn();

  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue(user);
    sqlite = new Database(":memory:");
    sqlite.exec(
      readFileSync(new URL("../../schema.sql", import.meta.url), "utf8").replace(
        /^CREATE TABLE IF NOT EXISTS 'pages_fts[^']+'.*;\n/gm,
        "",
      ),
    );
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES
      ('author','Author','author@example.com',0,0), ('other','Other','other@example.com',0,0);
      INSERT INTO tags (slug, label_ja, label_en, color) VALUES ('tag', 'タグ', 'Tag', 'blue');`);
    bucketGet
      .mockReset()
      .mockResolvedValue({ body: "bytes", httpMetadata: { contentType: "image/png" } });
    bucketPut.mockReset().mockResolvedValue({});
    bucketDelete.mockReset().mockResolvedValue(undefined);
    batch
      .mockReset()
      .mockImplementation(async (statements: Statement[]) =>
        sqlite.transaction(() => statements.map((statement) => statement.runSync()))(),
      );
    env = {
      DB: { prepare: (sql: string) => new Statement(sqlite, sql), batch },
      BUCKET: { get: bucketGet, put: bucketPut, delete: bucketDelete },
    } as unknown as Env;
  });
  afterEach(() => sqlite.close());

  function page(id: string, parent: string | null = null, author = "author") {
    sqlite
      .prepare(`INSERT INTO pages(id, slug, title_ja, title_en, content_ja, content_en, parent_id, author_id, last_edited_by, status, visibility)
      VALUES (?, ?, ?, ?, '本文', 'English body', ?, ?, ?, 'published', 'public')`)
      .run(id, id, id, id, parent, author, author);
  }
  function row(id: string) {
    return sqlite.prepare("SELECT * FROM pages WHERE id = ?").get(id) as Record<string, unknown>;
  }

  it("copies a complete private tree, attachments, sources and links, without sharing or activity", async () => {
    page("outside");
    page("parent", "outside");
    page("child", "parent");
    page("grandchild", "child");
    page("archived", "parent");
    sqlite.exec(`UPDATE pages SET status = 'archived' WHERE id = 'archived';
      UPDATE pages SET content_ja = '[child](/wiki/outside/parent/child?lang=en#heading) ![image](/api/images/wiki/parent/image.png)',
        content_en = '<acl level="organizer">secret</acl>', acl_source_ids = '[]' WHERE id = 'parent';
      UPDATE pages SET sort_order = 4 WHERE id = 'child';
      INSERT INTO page_tags(page_id, tag_slug) VALUES ('parent', 'tag');
      INSERT INTO page_sources(id, page_id, url, title) VALUES ('source', 'parent', 'https://example.com', 'Source');
      INSERT INTO page_attachments(id, page_id, r2_key, file_name, mime_type) VALUES ('attachment', 'parent', 'wiki/parent/image.png', 'image.png', 'image/png');
      INSERT INTO page_access(id,page_id,subject_type,subject_key,subject_label,role,granted_by) VALUES ('grant','parent','email','other@example.com','Other','editor','author');
      INSERT INTO page_favorites(user_id,page_id) VALUES ('author','parent');
      INSERT INTO page_comments(id,page_id,author_id,content_json) VALUES ('comment','parent','author','hello');`);
    const path = await duplicatePage(
      env,
      user,
      [{ chapterId: "chapter", chapterSlug: "chapter", role: "organizer" }],
      "parent",
      "https://wiki.example.com",
    );
    const root = sqlite
      .prepare("SELECT * FROM pages WHERE slug = ?")
      .get(path.split("/").at(-1)) as Record<string, unknown>;
    const copies = sqlite.prepare("SELECT * FROM pages WHERE slug LIKE '%-copy-%'").all() as Record<
      string,
      unknown
    >[];
    expect(copies).toHaveLength(3);
    for (const copy of copies) {
      expect(copy).toMatchObject({
        visibility: "restricted",
        author_id: "author",
        origin: "human",
        chapter_id: null,
        ingestion_session_id: null,
        acl_synced_with_parent: 1,
      });
      expect(sqlite.prepare("SELECT * FROM page_access WHERE page_id = ?").all(copy.id)).toEqual(
        [],
      );
      expect(sqlite.prepare("SELECT * FROM page_comments WHERE page_id = ?").all(copy.id)).toEqual(
        [],
      );
      expect(sqlite.prepare("SELECT * FROM page_favorites WHERE page_id = ?").all(copy.id)).toEqual(
        [],
      );
    }
    expect(root.title_ja).toBe("parent コピー");
    expect(root.parent_id).toBeNull();
    expect(root.content_en).toBe('<acl level="organizer">secret</acl>');
    const child = copies.find((copy) => copy.title_ja === "child");
    expect(child).toMatchObject({ parent_id: root.id, sort_order: 4 });
    expect(copies.find((copy) => copy.title_ja === "grandchild")?.parent_id).toBe(child?.id);
    expect(root.content_ja).toContain(`${path}/${child?.slug}?lang=en#heading`);
    const attachment = sqlite
      .prepare("SELECT * FROM page_attachments WHERE page_id = ?")
      .get(root.id) as { r2_key: string };
    expect(root.content_ja).toContain(`/api/images/${attachment.r2_key}`);
    expect(attachment.r2_key).not.toBe("wiki/parent/image.png");
    expect(bucketPut).toHaveBeenCalledOnce();
    expect(sqlite.prepare("SELECT tag_slug FROM page_tags WHERE page_id = ?").get(root.id)).toEqual(
      { tag_slug: "tag" },
    );
    expect(sqlite.prepare("SELECT url FROM page_sources WHERE page_id = ?").get(root.id)).toEqual({
      url: "https://example.com",
    });
    expect(row("parent").visibility).toBe("public");
  });

  it.each(["other-owner", "wiki-index", "wiki-log", "acl"])(
    "rejects the entire copy for an inaccessible child: %s",
    async (kind) => {
      page("parent");
      page("child", "parent", kind === "other-owner" ? "other" : "author");
      if (kind === "acl")
        sqlite
          .prepare("UPDATE pages SET content_en = ? WHERE id = 'child'")
          .run('<acl level="organizer">secret</acl>');
      else if (kind.startsWith("wiki-"))
        sqlite.prepare("UPDATE pages SET page_type = ? WHERE id = 'child'").run(kind);
      await expect(
        duplicatePage(env, user, [], "parent", "https://wiki.example.com"),
      ).rejects.toMatchObject({ status: 403 });
      expect(batch).not.toHaveBeenCalled();
      expect(bucketPut).not.toHaveBeenCalled();
    },
  );

  it("rolls back every page and cleans up independent attachments on a DB failure", async () => {
    page("parent");
    page("child", "parent");
    sqlite.exec(`INSERT INTO page_attachments(id,page_id,r2_key,file_name,mime_type) VALUES ('a','parent','wiki/parent/a.png','a.png','image/png');
      CREATE TRIGGER reject_copy BEFORE INSERT ON pages WHEN NEW.title_ja = 'child' AND NEW.id != 'child'
      BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    await expect(
      duplicatePage(env, user, [], "parent", "https://wiki.example.com"),
    ).rejects.toThrow("test failure");
    expect(sqlite.prepare("SELECT id FROM pages WHERE slug LIKE '%-copy-%'").all()).toEqual([]);
    expect(bucketDelete).toHaveBeenCalledWith(bucketPut.mock.calls[0][0]);
  });

  it("cleans up uploaded objects and creates no pages when a later attachment is missing", async () => {
    page("parent");
    sqlite.exec(`INSERT INTO page_attachments(id,page_id,r2_key,file_name,mime_type) VALUES
      ('a','parent','wiki/parent/a.png','a.png','image/png'), ('b','parent','wiki/parent/b.png','b.png','image/png');`);
    bucketGet.mockResolvedValueOnce({ body: "bytes" }).mockResolvedValueOnce(null);
    await expect(
      duplicatePage(env, user, [], "parent", "https://wiki.example.com"),
    ).rejects.toThrow("Attachment is missing");
    expect(batch).not.toHaveBeenCalled();
    expect(bucketDelete).toHaveBeenCalledOnce();
  });

  it("moves to the end, retains children and sharing, and supports root moves", async () => {
    page("old");
    page("new");
    page("moving", "old");
    page("child", "moving");
    page("sibling", "new");
    sqlite.exec(
      `INSERT INTO page_access(id,page_id,subject_type,subject_key,subject_label,role,granted_by) VALUES ('grant','moving','email','other@example.com','Other','editor','author');`,
    );
    await movePage(env, user, {
      pageId: "moving",
      newParentId: "new",
      insertAfterId: null,
      append: true,
    });
    expect(row("moving")).toMatchObject({
      parent_id: "new",
      sort_order: 1,
      acl_synced_with_parent: 0,
      visibility: "public",
    });
    expect(row("child").parent_id).toBe("moving");
    expect(
      sqlite.prepare("SELECT id FROM page_access WHERE page_id = 'moving'").all(),
    ).toHaveLength(1);
    await movePage(env, user, {
      pageId: "moving",
      newParentId: null,
      insertAfterId: null,
      append: true,
    });
    expect(row("moving")).toMatchObject({ parent_id: null, acl_synced_with_parent: 1 });
  });

  it.each(["self", "descendant", "foreign", "archived", "managed"])(
    "rejects invalid destination %s without mutation",
    async (kind) => {
      page("parent");
      page("child", "parent");
      page("foreign", null, "other");
      page("archived");
      page("managed");
      sqlite.exec(
        "UPDATE pages SET status='archived' WHERE id='archived'; UPDATE pages SET page_type='wiki-index' WHERE id='managed'",
      );
      await expect(
        movePage(env, user, {
          pageId: "parent",
          newParentId: kind === "self" ? "parent" : kind === "descendant" ? "child" : kind,
          insertAfterId: null,
        }),
      ).rejects.toBeInstanceOf(Response);
      expect(batch).not.toHaveBeenCalled();
    },
  );

  it("lists only eligible owned destinations and excludes the entire source subtree", async () => {
    page("parent");
    page("child", "parent");
    page("allowed");
    page("foreign", null, "other");
    page("archived");
    page("managed");
    sqlite.exec(
      "UPDATE pages SET status='archived' WHERE id='archived'; UPDATE pages SET page_type='wiki-log' WHERE id='managed'",
    );
    const response = await loadMoveTargets({
      request: new Request("https://wiki.test/api/pages/move-targets?pageId=parent"),
      context: { cloudflare: { env } },
    } as never);
    expect(await response.json()).toMatchObject({ targets: [{ id: "allowed" }] });
    vi.mocked(requireUser).mockResolvedValue({ ...user, isAdmin: true });
    const adminResponse = await loadMoveTargets({
      request: new Request("https://wiki.test/api/pages/move-targets?pageId=parent"),
      context: { cloudflare: { env } },
    } as never);
    expect(
      ((await adminResponse.json()) as { targets: { id: string }[] }).targets.map(
        (item) => item.id,
      ),
    ).toEqual(["allowed", "foreign"]);
  });

  it("rejects archived move sources", async () => {
    page("parent");
    sqlite.exec("UPDATE pages SET status='archived' WHERE id='parent'");
    await expect(
      movePage(env, user, { pageId: "parent", newParentId: null, insertAfterId: null }),
    ).rejects.toMatchObject({ status: 404 });
    expect(batch).not.toHaveBeenCalled();
  });
});
